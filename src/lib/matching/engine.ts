import type { SupabaseClient } from "@supabase/supabase-js";

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
}

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
  badge_background_checked?: boolean;
  has_portfolio?: boolean;
  last_active_at?: string;
  sms_notifications?: boolean;
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

  if (profile.has_portfolio) {
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
        badge_licensed, badge_insured, badge_background_checked,
        has_portfolio, last_active_at, sms_notifications,
        years_experience, license_state
      )`
    )
    .eq("zip", zip)
    .eq("status", "active");

  if (terrError) {
    console.error("Territory lookup error:", terrError);
    return [];
  }

  if (!territories || territories.length === 0) {
    return [];
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
  }));
}

/* ── Convenience: get the full profile for a matched contractor (used by intake API for notifications) ── */
export function getMatchProfile(
  supabase: SupabaseClient,
  contractorId: string
) {
  return supabase
    .from("profiles")
    .select("id, email, phone, full_name, company_name, trade, sms_notifications")
    .eq("id", contractorId)
    .single();
}
