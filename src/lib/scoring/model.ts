/* ── Henri Lead Scoring Engine ────────────────────────────────────────────── */
/*  Multi-signal deterministic scoring. No LLM calls — pure math.            */
/*  6 score components (91-pt base budget) + 5 additive boosters (15 pts),   */
/*  clamped to 100. See SCORE_COMPONENT_MAX for the per-component ceilings.  */
/* ───────────────────────────────────────────────────────────────────────── */

import { getSeasonalFactor, getSeasonLabel } from "./seasonal";

/* ── Input signals ─────────────────────────────────────────────────────── */

export interface ScoringSignals {
  /* Time signals */
  permitAge: number;            // days since permit filed
  daysSinceCreated: number;     // days since lead created in our system

  /* Value signals */
  permitValue: number | null;   // dollar value from permit
  /**
   * True when `permitValue` did NOT come off the permit — it is the
   * value-forecast model's estimate, used because `estimated_value` was
   * null (see `buildSignals`).
   *
   * 2026-08-05 fix (audit finding D): the forecast used to be merged into
   * `permitValue` with no provenance at all, so the score breakdown
   * asserted a concrete figure — "High-value permit ($250K)" — for a permit
   * that has no value on file. That is a fabricated metric shown to a
   * paying contractor and a direct violation of the truthfulness rule.
   * Everything that renders a permit value must branch on this flag and say
   * that the number is modeled.
   */
  permitValueIsModeled?: boolean;
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

  /* Wave 1.5 sidecar signals — pulled from canonical-data-layer
   * tables populated by /api/cron/swdi-events and
   * /api/cron/courtlistener-liens. Both are OPTIONAL — when null,
   * the corresponding component contributes 0 (no boost), so
   * existing scoring stays stable until the score cron starts
   * plumbing these values through. */

  /** Highest-magnitude recent storm event (hail/wind/tornado)
   * within 25 miles of the lead in the last 24 hours. Captures the
   * "fresh storm just hit" signal that drives roofing/exterior
   * surge. Set to `null` when no event nearby or signal not
   * computed yet. Higher = stronger boost. */
  stormProximity24h?: number | null;

  /** Number of mechanic-lien dockets in the same zip filed in the
   * last 90 days. A non-zero value means there's payment-distress
   * activity nearby, which is a contractor-outreach trigger. Set
   * to `null` when not computed yet. */
  recentLienCount?: number | null;

  /** FEMA National Risk Index composite score 0-100 for the lead's
   * census tract (preferred) or county (fallback). Rationale: high-
   * disaster-likelihood ZIPs see more frequent storm-driven claims
   * and rebuild work, so contractors targeting those areas need to
   * see them surface higher. Pure-numeric pass-through; null when
   * the score cron hasn't joined NRI yet or the lead's geography
   * isn't in our risk_nri_* tables. */
  nriRiskScore?: number | null;

  /** Count of NFIP flood claims in the lead's ZIP since 1978.
   * Restoration-trade signal — a high count means flood damage is
   * a recurring shape in the area. Pass-through, null when the
   * sidecar isn't joined yet. */
  nfipClaimCount?: number | null;

  /** Number of M3.5+ USGS earthquakes within 50mi of the lead in
   * the last 365 days. Boosts chimney / foundation / structural
   * trades. Pass-through, null when the sidecar isn't joined yet. */
  recentQuakeCount?: number | null;
}

/* ── Calibration shape (Module 13) ─────────────────────────────────────── */

/**
 * Per-trade weight multipliers applied to the four base components
 * (freshness, value, contact, demand) BEFORE the booster sum and the
 * stage cap are applied. Sourced from `score_trade_weights` (migration
 * 00090). All weights default to 1.0 so a missing row is a no-op.
 */
export interface TradeWeightRow {
  trade: string;
  freshness_weight: number;
  value_weight: number;
  contact_weight: number;
  demand_weight: number;
}

/**
 * Per-stage cap + multiplier applied AFTER component summing so noisy
 * stages (`pre_intent`, `archived`) can't surface as hot. Sourced from
 * `score_stage_modifiers` (migration 00090). Defaults: cap=100,
 * base_modifier=1.0 (a no-op).
 */
export interface StageModifierRow {
  stage: string;
  cap: number;
  base_modifier: number;
}

/**
 * Optional calibration overrides passed per-lead. Both fields default
 * to safe no-ops; the cron pre-fetches the small calibration tables
 * once and looks up the right row per (trade, stage).
 */
export interface ScoreCalibration {
  tradeWeights?: TradeWeightRow | null;
  stageModifier?: StageModifierRow | null;
}

/* ── Output shape ──────────────────────────────────────────────────────── */

export type Urgency = "hot" | "warm" | "cool" | "cold";

/**
 * The maximum points each component can award, keyed by its `ScoreResult`
 * field. THIS IS THE SINGLE SOURCE OF TRUTH — `reconcileComponents` clamps
 * against it and `signals.ts` renders it as the denominator in the drawer's
 * "Why this score" rows ("3/6"). Keeping the two in one place is the whole
 * point: when they were duplicated, `historical_conversion` advertised a
 * ceiling of 15 that its own mapping could not pay (see `scoreConversion`)
 * and nothing caught it.
 *
 * Every weight here MUST be attainable by some real input — that invariant
 * is asserted in `__tests__/scoring.test.ts` ("every declared weight is
 * attainable"). A denominator a lead can never reach is a fabricated number
 * shown to a paying contractor.
 */
export const SCORE_COMPONENT_MAX = {
  freshness: 20,
  value: 20,
  contact: 15,
  demand: 15,
  engagement: 15,
  conversion: 6,
  storm: 5,
  lien: 3,
  nri: 3,
  nfip: 2,
  quake: 2,
} as const;

export interface ScoreResult {
  total: number;         // 0-100
  freshness: number;     // 0-20
  value: number;         // 0-20
  contact: number;       // 0-15
  demand: number;        // 0-15
  engagement: number;    // 0-15
  conversion: number;    // 0-6  (see scoreConversion — full credit at a 40% close rate)
  /* Wave 1.5 + 2.A additive boosters — all default 0 when the input
   * signal is null. Capped sums are folded into `total` via
   * Math.min(100, ...) so urgency thresholds stay at 75/50/25. */
  storm?: number;        // 0-5 (storm_proximity_24h booster)
  lien?: number;         // 0-3 (recent_lien_90d booster)
  nri?: number;          // 0-3 (FEMA NRI risk-tier booster)
  nfip?: number;         // 0-2 (NFIP flood-claim density booster)
  quake?: number;        // 0-2 (USGS recent-quake booster)
  urgency: Urgency;
  factors: string[];     // human-readable boost/penalty reasons
}

/* ── Scoring logic ─────────────────────────────────────────────────────── */

/**
 * Compute freshness score (0-20).
 * Freshness reflects the REAL permit date only (issued/applied), never the
 * ingest date.
 *
 * 2026-06-17 fix: this used `Math.min(permitAge, daysSinceCreated)` for "the
 * most favorable interpretation," which let a fresh INGEST date override an
 * old or missing permit date — a decade-old permit (or one with no date at
 * all, ~28% of rows where permitAge is +Infinity) scored "Filed today." That
 * inflated freshness is the root of the dishonest urgency that the
 * speed-to-lead wedge depends on. Now: score from `permitAge` alone; a permit
 * with no usable date floors to 0. `daysSinceCreated` is no longer consulted.
 */
function scoreFreshness(signals: ScoringSignals, factors: string[]): number {
  const age = signals.permitAge;

  // No usable permit date (null issued AND applied → permitAge is +Infinity).
  if (!Number.isFinite(age) || age < 0) {
    factors.push("Permit date unknown");
    return 0;
  }

  let score: number;
  if (age < 1) {
    score = 20;
    factors.push("Filed today");
  } else if (age < 3) {
    score = 16;
    factors.push(`Filed ${Math.ceil(age)} day${Math.ceil(age) >= 2 ? "s" : ""} ago`);
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
  // Audit finding D: a modeled value must never be worded like a filed one.
  // The factor string produced here is the human-readable evidence a
  // contractor reads in the "Why this score" drawer, so "High-value permit
  // ($250K)" on a permit with no `estimated_value` is a number we invented
  // presented as a number the city published. Same points, different words.
  const modeled = signals.permitValueIsModeled === true;
  const modeledFactor = (v: number) =>
    `Estimated value ~$${formatCompact(v)} (modeled from comparable permits — no value filed)`;
  if (pv != null && pv > 0) {
    if (pv >= 100_000) {
      score = 20;
      factors.push(modeled ? modeledFactor(pv) : `High-value permit ($${formatCompact(pv)})`);
    } else if (pv >= 50_000) {
      score = 16;
      factors.push(modeled ? modeledFactor(pv) : `Substantial permit ($${formatCompact(pv)})`);
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

  // NOTE (2026-08-07): a `if (score === 0 && hasOwnerName) score = 3` floor
  // used to sit here, commented as the thing keeping 99% of leads off
  // contact=0. It was unreachable — `hasOwnerName` unconditionally adds 5
  // above, so `score` is never 0 when the guard's own condition holds. Live
  // data confirms it never ran: the owner-name-only population scores 5, not
  // 3. Removed rather than "fixed", because the +5 branch already does the
  // job the floor was written for.

  return Math.min(SCORE_COMPONENT_MAX.contact, score);
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
 * National home-improvement lead → close rate sits around 18% across
 * industry benchmarks (ServiceTitan, Angi, HomeAdvisor reports). Used as
 * the baseline when we have no local history; without it the scorer floors
 * at 0 on fresh markets, which reads as "this ZIP never converts" when the
 * truth is "we have not sold here yet".
 */
const NATIONAL_BASELINE_CLOSE_RATE = 0.18;

/**
 * The close rate that earns FULL credit on this component — roughly double
 * the national baseline, i.e. a genuinely exceptional market/trade. Rates at
 * or above this saturate the component.
 */
const CONVERSION_FULL_CREDIT_RATE = 0.40;

/**
 * Compute historical conversion score (0-6).
 *
 * 2026-08-07 fix — the unreachable-weight defect that pinned the whole
 * scale. This component used to declare a ceiling of 15 and compute
 * `zipRate * 7.5 + tradeRate * 7.5`, so paying out 15 required a 100% close
 * rate in BOTH the ZIP and the trade. That is not a data gap, it is an
 * impossible denominator: across 161,345 leads scored by the current model
 * the component had NEVER exceeded 3, and 97%+ sat at exactly the 3-point
 * baseline fallback. The 12 permanently-unawarded points were the single
 * largest term holding the 100-point scale's live ceiling down at 64, and
 * the drawer rendered them to contractors as a 3/15 progress bar — a
 * fabricated ceiling, which the truthfulness rule forbids.
 *
 * The mapping below is UNCHANGED for every close rate at or under
 * `CONVERSION_FULL_CREDIT_RATE` (3 points per side at 0.40 is exactly the
 * old `rate * 7.5`), so no existing lead's score moves. The only difference
 * is that the declared ceiling is now a number a lead can actually reach.
 */
function scoreConversion(signals: ScoringSignals, factors: string[]): number {
  const MAX = SCORE_COMPONENT_MAX.conversion;
  const perSide = MAX / 2;

  const zipRate = signals.zipConversionRate ?? NATIONAL_BASELINE_CLOSE_RATE;
  const tradeRate = signals.tradeConversionRate ?? NATIONAL_BASELINE_CLOSE_RATE;

  // Points per percentage-point of close rate. Written as `rate * K` rather
  // than `rate / BENCHMARK * perSide` so the float arithmetic is bit-for-bit
  // identical to the pre-2026-08-07 `rate * 7.5` — otherwise a 0.30 rate
  // rounds to 4 instead of 5 and existing leads shift by a point.
  const pointsPerRate = perSide / CONVERSION_FULL_CREDIT_RATE;
  const credit = (rate: number) =>
    Math.min(perSide, Math.max(0, rate) * pointsPerRate);

  const score = credit(zipRate) + credit(tradeRate);

  if (signals.zipConversionRate != null && signals.zipConversionRate >= 0.3) {
    factors.push(`Strong ZIP conversion history (${Math.round(signals.zipConversionRate * 100)}%)`);
  }
  if (signals.tradeConversionRate != null && signals.tradeConversionRate >= 0.3) {
    factors.push(`Strong trade conversion history (${Math.round(signals.tradeConversionRate * 100)}%)`);
  }

  return Math.min(MAX, Math.max(0, Math.round(score)));
}

/**
 * Compute Wave 1.5 storm-proximity booster (0-5).
 * Input is the highest-magnitude SWDI signature within 25mi / 24h.
 * Mapping (proximity score -> booster):
 *   null     -> 0  (no signal)
 *   0..25    -> 1
 *   25..50   -> 2
 *   50..75   -> 3
 *   75..90   -> 4
 *   90..100  -> 5
 */
function scoreStormBooster(signals: ScoringSignals, factors: string[]): number {
  const v = signals.stormProximity24h;
  if (v == null || v <= 0) return 0;
  const clamped = Math.min(100, Math.max(0, v));
  let boost = 1;
  if (clamped >= 90) boost = 5;
  else if (clamped >= 75) boost = 4;
  else if (clamped >= 50) boost = 3;
  else if (clamped >= 25) boost = 2;
  factors.push(`Storm signature within 25mi / 24h (+${boost})`);
  return boost;
}

/**
 * Compute Wave 1.5 recent-lien booster (0-3).
 * Input is the count of mechanic-lien dockets in the same zip in
 * the last 90 days. A single nearby lien is a soft signal; clusters
 * suggest payment-distress trends in the area.
 */
function scoreLienBooster(signals: ScoringSignals, factors: string[]): number {
  const n = signals.recentLienCount;
  if (n == null || n <= 0) return 0;
  let boost = 1;
  if (n >= 5) boost = 3;
  else if (n >= 2) boost = 2;
  factors.push(
    `${n} payment-distress filing${n === 1 ? "" : "s"} nearby (+${boost})`,
  );
  return boost;
}

/**
 * Wave 2.A booster — FEMA National Risk Index tier (0-3).
 * High-disaster-likelihood tracts see more frequent storm-driven
 * claims and rebuild work, which is what most Henri contractors
 * actually want to find.
 *   null            → 0
 *   0-50  (low)     → 0
 *   50-75 (moderate)→ 1
 *   75-90 (high)    → 2
 *   90-100 (very high) → 3
 */
function scoreNriBooster(signals: ScoringSignals, factors: string[]): number {
  const v = signals.nriRiskScore;
  if (v == null || v <= 50) return 0;
  let boost = 1;
  if (v >= 90) boost = 3;
  else if (v >= 75) boost = 2;
  factors.push(`High-disaster-risk area (NRI ${Math.round(v)}/100, +${boost})`);
  return boost;
}

/**
 * Wave 2.B booster — NFIP flood-claim density (0-2).
 * Restoration-trade signal: ZIPs with many flood claims see
 * recurring damage patterns and homeowners who already know to
 * call a contractor when water comes in.
 *   null      → 0
 *   <5        → 0
 *   5-20      → 1
 *   20+       → 2
 */
function scoreNfipBooster(signals: ScoringSignals, factors: string[]): number {
  const n = signals.nfipClaimCount;
  if (n == null || n < 5) return 0;
  const boost = n >= 20 ? 2 : 1;
  factors.push(`${n} NFIP flood claims in ZIP (+${boost})`);
  return boost;
}

/**
 * Wave 1 booster — recent USGS earthquakes nearby (0-2).
 * Drives chimney / foundation / structural lead surges. Capped
 * lower than storms because earthquake events are sparser and
 * cause smaller-radius damage clusters.
 *   null  → 0
 *   1     → 1
 *   2+    → 2
 */
function scoreQuakeBooster(signals: ScoringSignals, factors: string[]): number {
  const n = signals.recentQuakeCount;
  if (n == null || n <= 0) return 0;
  const boost = n >= 2 ? 2 : 1;
  factors.push(`${n} M3.5+ earthquake${n === 1 ? "" : "s"} within 50mi (+${boost})`);
  return boost;
}

/**
 * Re-apportion the component scores so they add up EXACTLY to the stored
 * total after the stage modifier and the 100-point cap have been applied.
 *
 * Why this exists (audit 2026-08-04, wedge bullet #2 "Confidence is
 * transparent"): the stage modifier and the cap are applied to the SUM,
 * but the components were returned unscaled. `buildScoreSignalBreakdown`
 * persists those unscaled components into `leads.score_signals`, and
 * `ScoreSignalBreakdown.tsx` renders their sum next to the score circle —
 * so the drawer showed a circle reading 44 beside rows adding to 46, and
 * the 100-cap case diverged the same way whenever the boosters pushed the
 * raw sum past 100. A contractor cannot verify a score whose own evidence
 * doesn't add up.
 *
 * The stage modifier is a whole-lead confidence discount, so discounting
 * every contribution proportionally is what it actually means. Largest-
 * remainder apportionment guarantees the integers sum to `target` exactly
 * (naive per-component rounding does not), and each part stays inside its
 * design ceiling so `buildScoreSignalBreakdown`'s `Math.min(weight, raw)`
 * clamp can never silently drop a point back out of the sum.
 */
function reconcileComponents(
  parts: number[],
  caps: number[],
  target: number,
  sum: number,
): number[] {
  if (sum === target) return parts;          // common case — nothing to do
  if (sum <= 0 || target <= 0) return parts.map(() => 0);

  const ratio = target / sum;
  const scaled = parts.map((p, i) => Math.min(caps[i], p * ratio));
  const out = scaled.map((s) => Math.floor(s));

  // Hand the leftover whole points to the components with the biggest
  // fractional part that still have headroom under their ceiling.
  const byRemainder = scaled
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac);

  let remainder = target - out.reduce((n, v) => n + v, 0);
  let progressed = true;
  while (remainder > 0 && progressed) {
    progressed = false;
    for (const { i } of byRemainder) {
      if (remainder <= 0) break;
      if (out[i] < caps[i]) {
        out[i] += 1;
        remainder -= 1;
        progressed = true;
      }
    }
  }

  return out;
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
 * Total: 0-91 across 6 components (see SCORE_COMPONENT_MAX):
 *   freshness (0-20) + value (0-20) + contact (0-15) +
 *   demand (0-15) + engagement (0-15) + conversion (0-6)
 * plus up to 15 additive booster points, with the sum clamped to 100.
 * The base budget is 91, NOT 100 — `conversion` was reduced to the ceiling
 * its mapping can actually pay (2026-08-07). Anything rendering the score
 * as "N / 100" is overstating the denominator; sum SCORE_COMPONENT_MAX (or
 * the rendered rows' weights, as ScoreSignalBreakdown does) instead.
 *
 * The optional `calibration` arg applies (Module 13):
 *   - Per-trade weights to freshness/value/contact/demand BEFORE summing
 *   - A per-stage modifier and cap AFTER summing
 * Both default to no-ops (weight=1.0, cap=100, modifier=1.0) so callers
 * that don't pass calibration get the legacy behaviour unchanged.
 *
 * Returns sub-scores, urgency tier, and human-readable factor explanations.
 */
export function calculateScore(
  signals: ScoringSignals,
  calibration: ScoreCalibration = {},
): ScoreResult {
  const factors: string[] = [];

  const freshnessRaw  = scoreFreshness(signals, factors);
  const valueRaw      = scoreValue(signals, factors);
  const contactRaw    = scoreContact(signals, factors);
  const demandRaw     = scoreDemand(signals, factors);
  const engagement    = scoreEngagement(signals, factors);
  const conversion    = scoreConversion(signals, factors);

  // Module 13 — per-trade weights. Apply BEFORE summing so the
  // calibration shifts component contributions visibly in the
  // drawer breakdown. Each weighted component is re-clamped to its
  // legacy ceiling (20/20/15/15) so over-weighted trades don't push
  // any single signal past its design max — calibration shifts
  // emphasis, it doesn't break the budget.
  const tw = calibration.tradeWeights ?? null;
  const wFreshness = tw?.freshness_weight ?? 1.0;
  const wValue     = tw?.value_weight     ?? 1.0;
  const wContact   = tw?.contact_weight   ?? 1.0;
  const wDemand    = tw?.demand_weight    ?? 1.0;

  const freshness = Math.min(20, Math.max(0, Math.round(freshnessRaw * wFreshness)));
  const value     = Math.min(20, Math.max(0, Math.round(valueRaw     * wValue)));
  const contact   = Math.min(15, Math.max(0, Math.round(contactRaw   * wContact)));
  const demand    = Math.min(15, Math.max(0, Math.round(demandRaw    * wDemand)));

  if (tw && (wFreshness !== 1.0 || wValue !== 1.0 || wContact !== 1.0 || wDemand !== 1.0)) {
    factors.push(`Trade calibration applied (${tw.trade})`);
  }

  // Wave 1.5 + 2.A additive boosters — all capped so the total stays
  // within [0, 100] and urgency thresholds (75/50/25) keep their
  // meaning. Theoretical max booster sum: 5+3+3+2+2 = 15 pts on top
  // of the 91-pt base, but Math.min absorbs anything that would
  // otherwise push past 100.
  const storm = scoreStormBooster(signals, factors);
  const lien  = scoreLienBooster(signals, factors);
  const nri   = scoreNriBooster(signals, factors);
  const nfip  = scoreNfipBooster(signals, factors);
  const quake = scoreQuakeBooster(signals, factors);

  const componentSum =
    freshness + value + contact + demand + engagement + conversion +
    storm + lien + nri + nfip + quake;

  // Module 13 — per-stage modifier + cap. Applied AFTER component
  // summing so noisy stages (pre_intent, archived) can't surface as
  // hot regardless of how strong the underlying signals are. Default
  // is a no-op (modifier=1.0, cap=100). When a row's stage is
  // unknown (no calibration row supplied), the legacy 100-pt cap
  // applies untouched.
  const sm = calibration.stageModifier ?? null;
  const baseModifier = sm?.base_modifier ?? 1.0;
  const stageCap     = sm?.cap ?? 100;
  const modifiedTotal = componentSum * baseModifier;
  const total = Math.max(0, Math.min(stageCap, Math.min(100, Math.round(modifiedTotal))));

  if (sm && (sm.cap < 100 || sm.base_modifier !== 1.0)) {
    factors.push(`Stage modifier applied (${sm.stage}, cap ${sm.cap})`);
  }

  // Wedge bullet #2 — the "Why this score" rows in the drawer MUST add up
  // to the number on the score circle. `total` above is authoritative;
  // the components below are re-apportioned to match it exactly whenever
  // the stage modifier or the 100-point cap moved the sum.
  const [
    freshnessOut,
    valueOut,
    contactOut,
    demandOut,
    engagementOut,
    conversionOut,
    stormOut,
    lienOut,
    nriOut,
    nfipOut,
    quakeOut,
  ] = reconcileComponents(
    [freshness, value, contact, demand, engagement, conversion, storm, lien, nri, nfip, quake],
    [
      SCORE_COMPONENT_MAX.freshness,
      SCORE_COMPONENT_MAX.value,
      SCORE_COMPONENT_MAX.contact,
      SCORE_COMPONENT_MAX.demand,
      SCORE_COMPONENT_MAX.engagement,
      SCORE_COMPONENT_MAX.conversion,
      SCORE_COMPONENT_MAX.storm,
      SCORE_COMPONENT_MAX.lien,
      SCORE_COMPONENT_MAX.nri,
      SCORE_COMPONENT_MAX.nfip,
      SCORE_COMPONENT_MAX.quake,
    ],
    total,
    componentSum,
  );

  const urgency = deriveUrgency(total);

  return {
    total,
    freshness: freshnessOut,
    value: valueOut,
    contact: contactOut,
    demand: demandOut,
    engagement: engagementOut,
    conversion: conversionOut,
    storm: stormOut,
    lien: lienOut,
    nri: nriOut,
    nfip: nfipOut,
    quake: quakeOut,
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
    /**
     * Tier A+ Sprint 2 (F2.2) — predicted permit value for permits where
     * `estimated_value` is null. Computed by the value-forecast model
     * (src/lib/predictive/value-forecast.ts). When supplied AND
     * `estimated_value` is null, the scoring engine treats it as the
     * permit value. Never overrides an actual `estimated_value`. Pass
     * null/undefined to fall back to "no value" behaviour.
     */
    predicted_value?: number | null;
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
  /** Wave 1.5 — recent storm signature within 25mi / 24h, 0-100.
   *  Pass-through; defaults to null (no boost). */
  stormProximity24h?: number | null;
  /** Wave 1.5 — recent mechanic-lien dockets in the same zip in the
   *  last 90 days. Pass-through; defaults to null (no boost). */
  recentLienCount?: number | null;
  /** Wave 2.A — FEMA NRI risk score 0-100 for the lead's tract. */
  nriRiskScore?: number | null;
  /** Wave 2.B — count of NFIP flood claims in the lead's ZIP. */
  nfipClaimCount?: number | null;
  /** Wave 1 — count of M3.5+ USGS earthquakes within 50mi / 365d. */
  recentQuakeCount?: number | null;
}): ScoringSignals {
  const now = Date.now();

  /* Permit age: days since the permit was filed (issued/applied — the cron
   * passes COALESCE(issued_date, applied_date) as issue_date).
   *
   * When `issue_date` is null, `permitAge = +Infinity`; scoreFreshness floors
   * that to 0 ("Permit date unknown"). (Was audit B2, 2026-04-27: a null date
   * left permitAge=0 → falsely-maxed freshness. 2026-06-17: freshness now
   * reads permitAge ALONE — the ingest-date blend that re-introduced the same
   * optimism for stale-but-recently-ingested permits is removed.) */
  let permitAge = Number.POSITIVE_INFINITY;
  if (params.permit.issue_date) {
    const filed = new Date(params.permit.issue_date).getTime();
    const ageDays = (now - filed) / (1000 * 60 * 60 * 24);
    // A FUTURE filing date is a placeholder / data error. Leave permitAge
    // = +Infinity (scoreFreshness floors it to 0, "Permit date unknown")
    // rather than clamping a negative age to 0 — the old Math.max(0, …)
    // clamp falsely maxed freshness and mislabelled the lead "Filed today".
    if (Number.isFinite(ageDays) && ageDays >= 0) {
      permitAge = ageDays;
    }
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

  /* Permit value: prefer the actual estimated_value. When null, fall back
   * to the value-forecast prediction (Sprint 2 F2.2). Never overrides an
   * actual value. Returns null only when both inputs are null — the value
   * scorer then assigns 0 to that signal (no fabricated value).
   *
   * 2026-08-05 (audit finding D): the fallback is now flagged. The merge
   * itself was the bug — downstream (scoreValue's factor strings, and
   * signals.ts `detailFor`) had no way to tell a modeled figure from a
   * filed one and so worded both identically. `permitValueIsModeled` is
   * true only when the number came from the forecaster, i.e. when
   * `estimated_value` is null AND `predicted_value` supplied a value. */
  const permitValueResolved =
    params.permit.estimated_value ?? params.permit.predicted_value ?? null;
  const permitValueIsModeled =
    params.permit.estimated_value == null &&
    params.permit.predicted_value != null &&
    permitValueResolved != null;

  return {
    permitAge,
    daysSinceCreated,
    permitValue: permitValueResolved,
    permitValueIsModeled,
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
    stormProximity24h: params.stormProximity24h ?? null,
    recentLienCount: params.recentLienCount ?? null,
    nriRiskScore: params.nriRiskScore ?? null,
    nfipClaimCount: params.nfipClaimCount ?? null,
    recentQuakeCount: params.recentQuakeCount ?? null,
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
