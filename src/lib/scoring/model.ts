/* ── Henri Lead Scoring Engine ────────────────────────────────────────────── */
/*  Multi-signal deterministic scoring. No LLM calls — pure math.            */
/*  8 weighted factors, 6 score components, 0-100 total.                     */
/* ───────────────────────────────────────────────────────────────────────── */

import { getSeasonalFactor, getSeasonLabel } from "./seasonal";

/* ── Input signals ─────────────────────────────────────────────────────── */

export interface ScoringSignals {
  /* Time signals */
  permitAge: number;            // days since permit filed
  daysSinceCreated: number;     // days since lead created in our system

  /* Value signals */
  permitValue: number | null;   // dollar value from permit
  propertyValue: number | null; // assessed property value
  projectType: string | null;   // trade / permit type

  /* Contact signals */
  hasPhone: boolean;
  hasEmail: boolean;
  hasOwnerName: boolean;
  ownerOccupied: boolean | null;

  /* Market signals */
  zipDemandScore: number | null;   // from zip_demand_scores table (0-100)
  competitorCount: number;         // how many contractors serve this ZIP
  seasonalFactor: number;          // 0.5-1.5 based on trade + month

  /* Engagement signals (homeowner intake) */
  isHomeownerIntake: boolean;
  hasDescription: boolean;
  /** Number of permits at this address (>=1). Multi-permit properties are
   * owned by active investors/renovators and should warm the lead even
   * without explicit homeowner intake. */
  cascadeCount?: number;

  /* Historical signals */
  zipConversionRate: number | null;   // historical win rate for this ZIP (0-1)
  tradeConversionRate: number | null; // historical win rate for this trade (0-1)
}

/* ── Output shape ──────────────────────────────────────────────────────── */

export type Urgency = "hot" | "warm" | "cool" | "cold";

export interface ScoreResult {
  total: number;         // 0-100
  freshness: number;     // 0-20
  value: number;         // 0-20
  contact: number;       // 0-15
  demand: number;        // 0-15
  engagement: number;    // 0-15
  conversion: number;    // 0-15
  urgency: Urgency;
  factors: string[];     // human-readable boost/penalty reasons
}

/* ── Scoring logic ─────────────────────────────────────────────────────── */

/**
 * Compute freshness score (0-20).
 * Uses the minimum of permitAge and daysSinceCreated for the most
 * favorable interpretation — a permit filed 2 days ago but ingested
 * today is still "fresh."
 */
function scoreFreshness(signals: ScoringSignals, factors: string[]): number {
  const age = Math.min(signals.permitAge, signals.daysSinceCreated);

  let score: number;
  if (age < 1) {
    score = 20;
    factors.push("Filed today");
  } else if (age < 3) {
    score = 16;
    factors.push(`Filed ${Math.ceil(age)} day${age >= 2 ? "s" : ""} ago`);
  } else if (age < 7) {
    score = 12;
    factors.push(`Filed ${Math.ceil(age)} days ago`);
  } else if (age < 14) {
    score = 8;
  } else if (age < 30) {
    score = 4;
    factors.push("Aging permit (2-4 weeks old)");
  } else {
    score = 0;
    factors.push("Stale permit (30+ days old)");
  }

  return score;
}

/**
 * Compute value score (0-20).
 * Log-scale permit value with a bonus for high-value properties.
 */
function scoreValue(signals: ScoringSignals, factors: string[]): number {
  let score = 2; // baseline for permits with no value data

  const pv = signals.permitValue;
  if (pv != null && pv > 0) {
    if (pv >= 100_000) {
      score = 20;
      factors.push(`High-value permit ($${formatCompact(pv)})`);
    } else if (pv >= 50_000) {
      score = 16;
      factors.push(`Substantial permit ($${formatCompact(pv)})`);
    } else if (pv >= 25_000) {
      score = 12;
    } else if (pv >= 10_000) {
      score = 8;
    } else if (pv >= 5_000) {
      score = 4;
    }
  }

  /* Property value bonus: high-value homes tend to have bigger projects
     and homeowners who can afford to hire. */
  if (signals.propertyValue != null && signals.propertyValue >= 500_000) {
    const bonus = Math.min(3, Math.floor(signals.propertyValue / 500_000));
    score = Math.min(20, score + bonus);
    factors.push(`High-value property ($${formatCompact(signals.propertyValue)})`);
  }

  return score;
}

/**
 * Compute contact quality score (0-15).
 * Having more contact info = higher chance of reaching the homeowner.
 */
function scoreContact(signals: ScoringSignals, factors: string[]): number {
  let score = 0;

  if (signals.hasPhone) {
    score += 5;
    factors.push("Phone number available");
  }
  if (signals.hasEmail) {
    score += 3;
  }
  if (signals.hasOwnerName) {
    score += 5;
    factors.push("Owner name available");
  }
  if (signals.ownerOccupied === true) {
    score += 4;
    factors.push("Owner-occupied property");
  }

  // Partial-credit floor: most public permit feeds don't ship phone/email
  // but the mailing address IS on every permit. A name + mailing address
  // is a real contactable signal (direct mail, door-knock, public records
  // lookup). Without this, 99% of leads get contact=0 and the ceiling caps
  // at ~60 regardless of how hot the permit is.
  if (score === 0 && signals.hasOwnerName) score = 3;

  return Math.min(15, score);
}

/**
 * Compute market demand score (0-15).
 * Combines ZIP-level demand data with seasonal trade multiplier.
 */
function scoreDemand(signals: ScoringSignals, factors: string[]): number {
  /* ZIP demand: normalize 0-100 scale to 0-10 */
  let zipComponent = 5; // neutral default when no data
  if (signals.zipDemandScore != null) {
    zipComponent = Math.round((signals.zipDemandScore / 100) * 10);

    if (signals.zipDemandScore >= 70) {
      factors.push("Hot ZIP code");
    } else if (signals.zipDemandScore <= 20) {
      factors.push("Low-demand ZIP code");
    }
  }

  /* Competition penalty: more competitors = less opportunity */
  if (signals.competitorCount >= 4) {
    zipComponent = Math.max(0, zipComponent - 2);
    factors.push("Saturated market (4+ competitors in ZIP)");
  } else if (signals.competitorCount === 0) {
    zipComponent = Math.min(10, zipComponent + 1);
    factors.push("No competitor coverage in ZIP");
  }

  /* Seasonal component: factor 0.5-1.5 maps to 0-5 */
  const seasonalComponent = Math.round(
    ((signals.seasonalFactor - 0.5) / 1.0) * 5
  );

  if (signals.seasonalFactor >= 1.2 && signals.projectType) {
    const label = getSeasonLabel(signals.seasonalFactor);
    factors.push(`${capitalize(label)} for ${signals.projectType}`);
  } else if (signals.seasonalFactor <= 0.7 && signals.projectType) {
    const label = getSeasonLabel(signals.seasonalFactor);
    factors.push(`${capitalize(label)} for ${signals.projectType}`);
  }

  return Math.min(15, Math.max(0, zipComponent + seasonalComponent));
}

/**
 * Compute engagement score (0-15).
 * Homeowner-initiated leads are warmer than permit-only leads.
 */
function scoreEngagement(signals: ScoringSignals, factors: string[]): number {
  let score = 0;

  if (signals.isHomeownerIntake) {
    score += 10;
    factors.push("Homeowner-initiated request");
  }
  if (signals.hasDescription) {
    score += 5;
    if (signals.isHomeownerIntake) {
      factors.push("Detailed project description provided");
    }
  }

  // Cascade floor — an address that has filed 2+ permits belongs to an
  // active investor/renovator. That IS engagement (they're actively
  // improving the property) even without explicit homeowner intake.
  const cascade = signals.cascadeCount ?? 1;
  if (cascade >= 2 && score < 10) {
    score = Math.max(score, 10);
    factors.push(`Cascade property (${cascade} permits at address)`);
  }
  if (cascade >= 4 && score < 13) {
    score = Math.max(score, 13);
    factors.push(`Heavy-cascade property (${cascade} permits)`);
  }

  return Math.min(15, score);
}

/**
 * Compute historical conversion score (0-15).
 * Uses ZIP-level and trade-level win rates from historical data.
 */
function scoreConversion(signals: ScoringSignals, factors: string[]): number {
  // National home-improvement lead → close rate sits around 18% across
  // industry benchmarks (ServiceTitan, Angi, HomeAdvisor reports). Use this
  // as the baseline when we have no local history; without it the scorer
  // was floor-ing at 6/15 (2 × 3-point neutral fallback) on fresh markets.
  const NATIONAL_BASELINE = 0.18;

  const zipRate = signals.zipConversionRate ?? NATIONAL_BASELINE;
  const tradeRate = signals.tradeConversionRate ?? NATIONAL_BASELINE;

  let score = zipRate * 7.5 + tradeRate * 7.5;

  if (signals.zipConversionRate != null && signals.zipConversionRate >= 0.3) {
    factors.push(`Strong ZIP conversion history (${Math.round(signals.zipConversionRate * 100)}%)`);
  }
  if (signals.tradeConversionRate != null && signals.tradeConversionRate >= 0.3) {
    factors.push(`Strong trade conversion history (${Math.round(signals.tradeConversionRate * 100)}%)`);
  }

  return Math.min(15, Math.max(0, Math.round(score)));
}

/**
 * Derive urgency tier from total score.
 */
function deriveUrgency(total: number): Urgency {
  if (total >= 75) return "hot";
  if (total >= 50) return "warm";
  if (total >= 25) return "cool";
  return "cold";
}

/* ── Main scoring function ─────────────────────────────────────────────── */

/**
 * Calculate a comprehensive lead score from multi-signal inputs.
 *
 * Total: 0-100 across 6 components:
 *   freshness (0-20) + value (0-20) + contact (0-15) +
 *   demand (0-15) + engagement (0-15) + conversion (0-15)
 *
 * Returns sub-scores, urgency tier, and human-readable factor explanations.
 */
export function calculateScore(signals: ScoringSignals): ScoreResult {
  const factors: string[] = [];

  const freshness  = scoreFreshness(signals, factors);
  const value      = scoreValue(signals, factors);
  const contact    = scoreContact(signals, factors);
  const demand     = scoreDemand(signals, factors);
  const engagement = scoreEngagement(signals, factors);
  const conversion = scoreConversion(signals, factors);

  const total = Math.min(100, freshness + value + contact + demand + engagement + conversion);
  const urgency = deriveUrgency(total);

  return {
    total,
    freshness,
    value,
    contact,
    demand,
    engagement,
    conversion,
    urgency,
    factors,
  };
}

/* ── Signal builder helper ─────────────────────────────────────────────── */

/**
 * Build ScoringSignals from a raw permit + enrichment data.
 * This is the bridge between database rows and the scoring function.
 */
export function buildSignals(params: {
  permit: {
    issue_date?: string | null;
    estimated_value?: number | null;
    description?: string | null;
    permit_type?: string | null;
    zip?: string | null;
    created_at?: string;
  };
  lead?: {
    phone?: string | null;
    email?: string | null;
    owner_name?: string | null;
    owner_first?: string | null;
    owner_last?: string | null;
    owner_occupied?: boolean | null;
    property_value?: number | null;
    assessed_value?: number | null;
    is_homeowner_intake?: boolean;
    permit_description?: string | null;
    trade?: string | null;
    created_at?: string;
    /** Number of permits filed at this address (>=1). Drives cascade-engagement floor. */
    cascadeCount?: number;
  };
  zipDemandScore?: number | null;
  competitorCount?: number;
  zipConversionRate?: number | null;
  tradeConversionRate?: number | null;
}): ScoringSignals {
  const now = Date.now();

  /* Permit age: days since the permit was filed */
  let permitAge = 0;
  if (params.permit.issue_date) {
    const filed = new Date(params.permit.issue_date).getTime();
    permitAge = Math.max(0, (now - filed) / (1000 * 60 * 60 * 24));
  }

  /* Days since lead was created in our system */
  let daysSinceCreated = 0;
  const createdStr = params.lead?.created_at ?? params.permit.created_at;
  if (createdStr) {
    const created = new Date(createdStr).getTime();
    daysSinceCreated = Math.max(0, (now - created) / (1000 * 60 * 60 * 24));
  }

  /* Resolve trade from lead or permit */
  const trade = params.lead?.trade ?? params.permit.permit_type ?? null;

  /* Owner name: check both combined and split fields */
  const hasOwnerName = !!(
    params.lead?.owner_name ||
    params.lead?.owner_first ||
    params.lead?.owner_last
  );

  /* Description: from lead, permit, or either */
  const hasDescription = !!(
    params.lead?.permit_description ||
    params.permit.description
  );

  /* Property value: prefer assessed_value, fall back to property_value */
  const propertyValue = params.lead?.assessed_value ?? params.lead?.property_value ?? null;

  return {
    permitAge,
    daysSinceCreated,
    permitValue: params.permit.estimated_value ?? null,
    propertyValue,
    projectType: trade,
    hasPhone: !!params.lead?.phone,
    hasEmail: !!params.lead?.email,
    hasOwnerName,
    ownerOccupied: params.lead?.owner_occupied ?? null,
    zipDemandScore: params.zipDemandScore ?? null,
    competitorCount: params.competitorCount ?? 0,
    seasonalFactor: getSeasonalFactor(trade),
    isHomeownerIntake: params.lead?.is_homeowner_intake ?? false,
    hasDescription,
    cascadeCount: params.lead?.cascadeCount ?? 1,
    zipConversionRate: params.zipConversionRate ?? null,
    tradeConversionRate: params.tradeConversionRate ?? null,
  };
}

/* ── Utility ───────────────────────────────────────────────────────────── */

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
