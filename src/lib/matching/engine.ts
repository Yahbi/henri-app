import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

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
  licenseState: string | null;
  verified: boolean;
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
  badge_licensed?: boolean;
  badge_insured?: boolean;
  // Real column is profiles.badge_background (aliased in the select).
  badge_background_checked?: boolean;
  // Real column is profiles.portfolio_photos (text[]); has_portfolio derived.
  portfolio_photos?: string[] | null;
  // Aliased from profiles.updated_at (no last_active_at column exists).
  last_active_at?: string;
  years_experience?: number;
  license_state?: string;
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

/* ── Response time label ── */
function responseTimeLabel(hours?: number): string {
  if (!hours || hours < 1) return "within 1 hour";
  if (hours < 2) return "within 2 hours";
  if (hours < 4) return "within 4 hours";
  if (hours < 8) return "within 8 hours";
  if (hours < 24) return "within 24 hours";
  return "1-2 business days";
}

/* ── Response time score (out of 20) ── */
function responseTimeScore(hours?: number): number {
  if (!hours || hours < 1) return 20;
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

  /* 1. Trade match (30 points) */
  if (
    contractorTrade === normalizedTrade ||
    normalizedTrade.includes(contractorTrade) ||
    contractorTrade.includes(normalizedTrade)
  ) {
    score += 30;
    factors.push("Exact trade match");
  } else if (isRelatedTrade(normalizedTrade, contractorTrade)) {
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

  /* 4. Verification badges (15 points) */
  let verificationScore = 0;
  if (profile.badge_licensed) {
    verificationScore += 5;
    factors.push("Licensed");
  }
  if (profile.badge_insured) {
    verificationScore += 5;
    factors.push("Insured");
  }
  if (profile.badge_background_checked) {
    verificationScore += 5;
    factors.push("Background checked");
  }
  score += verificationScore;

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
        badge_licensed, badge_insured, badge_background_checked:badge_background,
        portfolio_photos, last_active_at:updated_at,
        years_experience, license_state
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

  /* Step 4: Return top 3 */
  const topCandidates = scored.slice(0, 3);

  return topCandidates.map((c) => ({
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
    licenseState: c.profile.license_state ?? null,
    verified:
      !!(c.profile.badge_licensed && c.profile.badge_insured),
    matchType: "territory" as const,
  }));
}

/* ── Proximity (cold-start) fallback ── */

/** Approximate miles between two lat/lng pairs (haversine). Mirrors the
 *  score cron's `haversineMi`. */
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
        badge_licensed, badge_insured, badge_background_checked:badge_background,
        portfolio_photos, last_active_at:updated_at,
        years_experience, license_state
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

  return scored.slice(0, 3).map((c) => ({
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
    licenseState: c.profile.license_state ?? null,
    verified: !!(c.profile.badge_licensed && c.profile.badge_insured),
    matchType: "proximity" as const,
    distanceMi: Math.round(c.mi),
  }));
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
