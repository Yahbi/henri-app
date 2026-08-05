import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { haversineMi } from "@/lib/geo/haversine";

/* ── Types ── */

export interface MatchCandidate {
  contractorId: string;
  companyName: string;
  score: number;
  factors: string[];
  estimatedResponseTime: string;
  rating: number;
  reviewCount: number;
  jobsCompleted: number;
  yearsExperience: number | null;
  /* Licence trust block — derived from `contractor_licenses`, NOT from
   * `profiles.badge_licensed` / `badge_insured`.
   *
   * `verified` used to be `!!(badge_licensed && badge_insured)`. Nothing in
   * src/ writes either column and migration 00117 hard-locks both, so that
   * expression was false for every contractor that has ever existed — a
   * flag the homeowner card rendered as "Licensed & Insured". The real
   * signal is the roster cross-check recorded by
   * /api/onboarding/verify-license, which migration 00127 makes
   * unforgeable. There is deliberately no insured/background-checked
   * equivalent: Henri collects neither. */
  licenseVerified: boolean;
  /** State of the verified licence. Null when there is no verified licence
   *  — this is NOT the contractor's self-declared `profiles.license_state`,
   *  which is a claim rather than a check. */
  licenseState: string | null;
  /** How this contractor was matched: an exact claimed-territory ZIP, or
   *  the geographic-proximity cold-start fallback (no exact match existed). */
  matchType: "territory" | "proximity";
  /** Miles from the intake ZIP to the contractor's nearest claimed ZIP.
   *  Only set for proximity matches. */
  distanceMi?: number;
}

/** Max miles for the cold-start proximity fallback. While Henri is filling
 *  out its contractor base, a homeowner whose exact ZIP nobody has claimed
 *  is still matched to the nearest pro within this radius rather than
 *  vanishing into manual-review limbo. */
const PROXIMITY_MAX_MI = 150;

export interface MatchParams {
  zip: string;
  trade: string;
  description?: string;
  budget?: number;
  urgency?: "asap" | "this_week" | "this_month" | "flexible";
}

interface ContractorRow {
  contractor_id: string;
  profiles: ContractorProfile | ContractorProfile[];
}

interface ContractorProfile {
  id: string;
  email?: string;
  phone?: string;
  full_name?: string;
  company_name?: string;
  trade?: string;
  plan?: string;
  avg_rating?: number;
  review_count?: number;
  response_time_h?: number;
  jobs_completed?: number;
  // Real column is profiles.portfolio_photos (text[]); has_portfolio derived.
  portfolio_photos?: string[] | null;
  // Aliased from profiles.updated_at (no last_active_at column exists).
  last_active_at?: string;
  years_experience?: number;
}

/** Newest verified, unexpired licence per contractor. */
interface VerifiedLicense {
  state: string | null;
}

/**
 * Licence lookup for a set of contractors, mirroring
 * /api/contractors/search:87-126.
 *
 * Degrades to an empty map on error: an unbadged match is honest, a failed
 * homeowner intake is not. Note that `contractor_licenses` is row-scoped by
 * RLS (licenses_select_own, 00010:44) — callers passing a user-session
 * client will read nothing and every match will come back unverified,
 * which is the safe direction. /api/intake calls this with the service-role
 * client (see the note at src/app/api/intake/route.ts:119-128).
 */
async function fetchVerifiedLicenses(
  supabase: SupabaseClient,
  contractorIds: string[]
): Promise<Map<string, VerifiedLicense>> {
  const byContractor = new Map<string, VerifiedLicense>();
  if (contractorIds.length === 0) return byContractor;

  /* Date-only compare: `expiry_date` is a DATE column. An expired licence
   * is not a licence; a NULL expiry means the roster publishes none, which
   * is not the same as expired. */
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("contractor_licenses")
    .select("contractor_id, license_state, last_checked_at")
    .in("contractor_id", contractorIds)
    .eq("verified", true)
    .or(`expiry_date.is.null,expiry_date.gte.${today}`)
    .order("last_checked_at", { ascending: false, nullsFirst: false });

  if (error) {
    logger.warn("Match licence lookup failed; licence flags suppressed", {
      error: error.message,
    });
    return byContractor;
  }

  /* Ordered newest-first, so the first row per contractor is the freshest
   * check (a multi-state contractor holds several). */
  for (const row of data ?? []) {
    const id = row.contractor_id as string;
    if (byContractor.has(id)) continue;
    byContractor.set(id, { state: (row.license_state as string | null) ?? null });
  }

  return byContractor;
}

/* ── In-memory assignment counter for round-robin tiebreaker ── */
const assignmentCounts = new Map<string, number>();

function getAssignmentCount(contractorId: string): number {
  return assignmentCounts.get(contractorId) ?? 0;
}

export function incrementAssignment(contractorId: string): void {
  assignmentCounts.set(contractorId, getAssignmentCount(contractorId) + 1);
}

/* ── Related-trade mapping ── */
const RELATED_TRADES: Record<string, string[]> = {
  "general remodel": [],
  general: [],
  plumbing: ["general remodel", "general", "bathroom remodel", "kitchen remodel"],
  electrical: ["general remodel", "general", "solar", "ev charger"],
  hvac: ["general remodel", "general"],
  roofing: ["general remodel", "general"],
  painting: ["general remodel", "general", "interior design"],
  flooring: ["general remodel", "general"],
  landscaping: ["general remodel", "general", "hardscape", "fencing"],
  "bathroom remodel": ["general remodel", "general", "plumbing", "tile"],
  "kitchen remodel": ["general remodel", "general", "plumbing", "countertops"],
  solar: ["electrical", "general remodel", "general"],
  fencing: ["landscaping", "general remodel", "general"],
  "window replacement": ["general remodel", "general"],
  "garage door": ["general remodel", "general"],
  concrete: ["general remodel", "general", "hardscape"],
  tile: ["general remodel", "general", "bathroom remodel", "flooring"],
};

function isRelatedTrade(requested: string, contractor: string): boolean {
  const norm = (s: string) => s.toLowerCase().trim();
  const reqNorm = norm(requested);
  const conNorm = norm(contractor);

  if (conNorm === "general remodel" || conNorm === "general") return true;

  const related = RELATED_TRADES[reqNorm];
  if (related && related.map(norm).includes(conNorm)) return true;

  return false;
}

/* ── Plan tier capacity points ── */
function planCapacityScore(plan?: string): number {
  switch (plan?.toLowerCase()) {
    case "enterprise":
      return 10;
    case "pro":
      return 8;
    case "starter":
      return 6;
    case "founder":
      return 4;
    default:
      return 4;
  }
}

/* ── Response time label ──
 * `hours == null` means we have NO measured response history (the norm at
 * launch — migration 00016 leaves response_time_h NULL until a contractor has
 * contacted leads). That must NOT be reported as the fastest tier — surfacing
 * "within 1 hour" for an unmeasured contractor is a fabricated metric. Only a
 * genuine measured value < 1 earns the top label. */
function responseTimeLabel(hours?: number | null): string {
  if (hours == null) return "response time not yet measured";
  if (hours < 1) return "within 1 hour";
  if (hours < 2) return "within 2 hours";
  if (hours < 4) return "within 4 hours";
  if (hours < 8) return "within 8 hours";
  if (hours < 24) return "within 24 hours";
  return "1-2 business days";
}

/* ── Response time score (out of 20) ──
 * Unmeasured (null) scores a neutral mid-band, not the full 20 — otherwise
 * every contractor is cold-start-inflated to a perfect responsiveness score
 * AND tagged "Fast response time" with no data behind it. */
function responseTimeScore(hours?: number | null): number {
  if (hours == null) return 10;
  if (hours < 1) return 20;
  if (hours < 2) return 16;
  if (hours < 4) return 12;
  if (hours < 8) return 8;
  if (hours < 24) return 4;
  return 0;
}

/* ── Core scoring ── */

function scoreContractor(
  profile: ContractorProfile,
  requestedTrade: string
): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  const contractorTrade = (profile.trade ?? "").toLowerCase().trim();
  const normalizedTrade = requestedTrade.toLowerCase().trim();

  /* 1. Trade match (30 points).
   * Guard against empty operands: `"roofing".includes("")` is ALWAYS true in
   * JS, so a contractor with a null/blank trade would otherwise score a false
   * 30-point "Exact trade match" for every request. A missing trade is a
   * no-match (0 pts), never an exact match. */
  if (
    contractorTrade &&
    normalizedTrade &&
    (contractorTrade === normalizedTrade ||
      normalizedTrade.includes(contractorTrade) ||
      contractorTrade.includes(normalizedTrade))
  ) {
    score += 30;
    factors.push("Exact trade match");
  } else if (contractorTrade && normalizedTrade && isRelatedTrade(normalizedTrade, contractorTrade)) {
    score += 15;
    factors.push("Related trade experience");
  }

  /* 2. Reputation (25 points): avg_rating * 4 + min(review_count, 50) / 10 */
  const rating = profile.avg_rating ?? 0;
  const reviews = profile.review_count ?? 0;
  const reputationScore = Math.min(25, rating * 4 + Math.min(reviews, 50) / 10);
  score += reputationScore;
  if (rating >= 4.5) {
    factors.push(`Top rated: ${rating.toFixed(1)} stars`);
  } else if (rating >= 4.0) {
    factors.push(`Highly rated: ${rating.toFixed(1)} stars`);
  }
  if (reviews >= 20) {
    factors.push(`${reviews} verified reviews`);
  }

  /* 3. Responsiveness (20 points) */
  const rtScore = responseTimeScore(profile.response_time_h);
  score += rtScore;
  if (rtScore >= 16) {
    factors.push("Fast response time");
  }

  /* 4. Verification badges — REMOVED.
   * This block awarded 5 points each for `badge_licensed`, `badge_insured`
   * and `badge_background_checked`, and pushed "Licensed" / "Insured" /
   * "Background checked" onto the factor list shown to the homeowner.
   * Nothing in src/ has ever written those three columns and migration
   * 00117 hard-locks them, so every term was 0 for every contractor: dead
   * weight in the score and three unearned claims in the factors. Henri
   * collects no insurance or background data at all, so there is nothing
   * honest to re-source them from. The one real licensing signal — the
   * state-roster cross-check — is surfaced as `licenseVerified` on the
   * candidate rather than folded into the score, so it can be shown to the
   * homeowner without silently reordering matches. */

  /* 5. Capacity based on plan tier (10 points) */
  const capScore = planCapacityScore(profile.plan);
  score += capScore;

  /* 6. Bonus factors */
  const jobsCompleted = profile.jobs_completed ?? 0;
  if (jobsCompleted > 10) {
    score += 3;
    factors.push(`${jobsCompleted} jobs completed`);
  }

  if (profile.last_active_at) {
    const lastActive = new Date(profile.last_active_at).getTime();
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (lastActive > twentyFourHoursAgo) {
      score += 2;
      factors.push("Recently active");
    }
  }

  if ((profile.portfolio_photos?.length ?? 0) > 0) {
    score += 1;
    factors.push("Portfolio available");
  }

  return { score: Math.min(100, Math.round(score)), factors };
}

/* ── Main matching function ── */

export async function findMatches(
  supabase: SupabaseClient,
  params: MatchParams
): Promise<MatchCandidate[]> {
  const { zip, trade } = params;

  /* Step 1: Territory filter -- contractor must have an active territory for this ZIP */
  const { data: territories, error: terrError } = await supabase
    .from("territories")
    .select(
      `contractor_id, profiles!inner(
        id, email, phone, full_name, company_name, trade, plan,
        avg_rating, review_count, response_time_h, jobs_completed,
        portfolio_photos, last_active_at:updated_at,
        years_experience
      )`
    )
    .eq("zip", zip)
    .eq("status", "active");

  if (terrError) {
    logger.error("Territory lookup error", {
      error: terrError.message ?? JSON.stringify(terrError),
    });
    // Don't strand the homeowner on a transient exact-match error — try
    // the proximity fallback before giving up.
    return findProximityMatches(supabase, params);
  }

  if (!territories || territories.length === 0) {
    // Cold-start fallback: nobody has claimed this exact ZIP. Rather than
    // dropping the homeowner into manual-review limbo, widen to the nearest
    // contractor(s) within PROXIMITY_MAX_MI. [decision 2026-06-10]
    return findProximityMatches(supabase, params);
  }

  const rows = territories as unknown as ContractorRow[];

  /* Step 2: Score each contractor */
  const scored: {
    contractorId: string;
    profile: ContractorProfile;
    score: number;
    factors: string[];
  }[] = [];

  for (const row of rows) {
    const profile: ContractorProfile = Array.isArray(row.profiles)
      ? row.profiles[0]
      : row.profiles;

    if (!profile) continue;

    const { score, factors } = scoreContractor(profile, trade);
    scored.push({ contractorId: row.contractor_id, profile, score, factors });
  }

  /* Step 3: Sort by score descending */
  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;

    /* Round-robin tiebreaker: if within 5 points, prefer the one with fewer assignments */
    if (Math.abs(scoreDiff) <= 5) {
      const aCount = getAssignmentCount(a.contractorId);
      const bCount = getAssignmentCount(b.contractorId);
      if (aCount !== bCount) return aCount - bCount;
    }

    return scoreDiff;
  });

  /* Step 4: Return top 3 (licence lookup only for the rows we return) */
  const topCandidates = scored.slice(0, 3);
  const licenses = await fetchVerifiedLicenses(
    supabase,
    topCandidates.map((c) => c.contractorId)
  );

  return topCandidates.map((c) => {
    const license = licenses.get(c.contractorId);
    return {
      contractorId: c.contractorId,
      companyName:
        c.profile.company_name ?? c.profile.full_name ?? "Contractor",
      score: c.score,
      factors: c.factors,
      estimatedResponseTime: responseTimeLabel(c.profile.response_time_h),
      rating: c.profile.avg_rating ?? 0,
      reviewCount: c.profile.review_count ?? 0,
      jobsCompleted: c.profile.jobs_completed ?? 0,
      yearsExperience:
        typeof c.profile.years_experience === "number" && c.profile.years_experience > 0
          ? c.profile.years_experience
          : null,
      licenseVerified: license !== undefined,
      licenseState: license?.state ?? null,
      matchType: "territory" as const,
    };
  });
}

/* ── Proximity (cold-start) fallback ── */

/** ZIP centroids derived from geocoded permits (no dedicated centroid
 *  table exists). One grouped query covers the intake ZIP + every claimed
 *  territory ZIP. Returns a map zip → {lat,lng}; ZIPs with no geocoded
 *  permit are simply absent. */
async function zipCentroids(
  supabase: SupabaseClient,
  zips: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const unique = [...new Set(zips.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data } = await supabase
    .from("permits")
    .select("zip, latitude, longitude")
    .in("zip", unique)
    .not("latitude", "is", null)
    .limit(20000);
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const r of (data ?? []) as Array<{ zip: string; latitude: number; longitude: number }>) {
    if (r.latitude == null || r.longitude == null) continue;
    const cur = acc.get(r.zip) ?? { lat: 0, lng: 0, n: 0 };
    cur.lat += r.latitude;
    cur.lng += r.longitude;
    cur.n += 1;
    acc.set(r.zip, cur);
  }
  for (const [zip, v] of acc) {
    if (v.n > 0) out.set(zip, { lat: v.lat / v.n, lng: v.lng / v.n });
  }
  return out;
}

export async function findProximityMatches(
  supabase: SupabaseClient,
  params: MatchParams,
): Promise<MatchCandidate[]> {
  const { zip, trade } = params;

  // All active territories with their contractor profiles.
  const { data: territories, error } = await supabase
    .from("territories")
    .select(
      `zip, contractor_id, profiles!inner(
        id, email, phone, full_name, company_name, trade, plan,
        avg_rating, review_count, response_time_h, jobs_completed,
        portfolio_photos, last_active_at:updated_at,
        years_experience
      )`,
    )
    .eq("status", "active");

  if (error || !territories || territories.length === 0) return [];

  const terrRows = territories as unknown as Array<ContractorRow & { zip: string }>;

  // Centroids for the intake ZIP + every claimed ZIP, in one query.
  const allZips = [zip, ...terrRows.map((t) => t.zip)];
  const centroids = await zipCentroids(supabase, allZips);
  const origin = centroids.get(zip);
  if (!origin) return []; // can't locate the intake ZIP — nothing to widen to.

  // Nearest claimed ZIP per contractor.
  const nearest = new Map<string, { profile: ContractorProfile; mi: number }>();
  for (const t of terrRows) {
    const c = centroids.get(t.zip);
    if (!c) continue;
    const mi = haversineMi(origin.lat, origin.lng, c.lat, c.lng);
    if (mi > PROXIMITY_MAX_MI) continue;
    const profile: ContractorProfile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
    if (!profile) continue;
    const prev = nearest.get(t.contractor_id);
    if (!prev || mi < prev.mi) nearest.set(t.contractor_id, { profile, mi });
  }

  if (nearest.size === 0) return [];

  const scored = [...nearest.entries()].map(([contractorId, { profile, mi }]) => {
    const { score, factors } = scoreContractor(profile, trade);
    return { contractorId, profile, mi, score, factors };
  });

  // Nearest first; score as a tiebreaker.
  scored.sort((a, b) => a.mi - b.mi || b.score - a.score);

  const top = scored.slice(0, 3);
  const licenses = await fetchVerifiedLicenses(
    supabase,
    top.map((c) => c.contractorId)
  );

  return top.map((c) => {
    const license = licenses.get(c.contractorId);
    return {
      contractorId: c.contractorId,
      companyName: c.profile.company_name ?? c.profile.full_name ?? "Contractor",
      score: c.score,
      factors: [`Nearby (~${Math.round(c.mi)} mi)`, ...c.factors],
      estimatedResponseTime: responseTimeLabel(c.profile.response_time_h),
      rating: c.profile.avg_rating ?? 0,
      reviewCount: c.profile.review_count ?? 0,
      jobsCompleted: c.profile.jobs_completed ?? 0,
      yearsExperience:
        typeof c.profile.years_experience === "number" && c.profile.years_experience > 0
          ? c.profile.years_experience
          : null,
      licenseVerified: license !== undefined,
      licenseState: license?.state ?? null,
      matchType: "proximity" as const,
      distanceMi: Math.round(c.mi),
    };
  });
}

/* ── Convenience: get the full profile for a matched contractor (used by intake API for notifications) ── */
export function getMatchProfile(
  supabase: SupabaseClient,
  contractorId: string
) {
  return supabase
    .from("profiles")
    .select("id, email, phone, full_name, company_name, trade")
    .eq("id", contractorId)
    .single();
}
