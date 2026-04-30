/* ── F2 — Cascade prediction ────────────────────────────────────────────
 *
 *  Tier A+ Sprint 1. Predicts follow-on-permit probability per lead based
 *  on permit-cascade history. Deterministic statistical query — NO LLM,
 *  NO PII.
 *
 *  Confidence levels:
 *    - low:    sample_size < 50
 *    - medium: 50 <= sample_size < 500
 *    - high:   sample_size >= 500
 *
 *  Predictions with sample_size < 10 are NOT persisted (not enough data
 *  to make a useful claim).
 *
 *  Cached in `cascade_predictions` table; refreshed weekly by
 *  /api/cron/predictive-refresh.
 *
 *  Reference: src/types/database.ts → public.address_permit_history
 *  (permit_count, permits jsonb array, trades text[]).
 * ──────────────────────────────────────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Henri's 7 canonical trades. Cascade predictions are restricted to these. */
export const CANONICAL_TRADES = [
  "roofing",
  "hvac",
  "plumbing",
  "electrical",
  "solar",
  "adu",
  "general remodel",
] as const;
export type CanonicalTrade = (typeof CANONICAL_TRADES)[number];

export type ConfidenceLabel = "low" | "medium" | "high";

export interface CascadePrediction {
  predicted_trade: CanonicalTrade;
  prob_90d: number;
  prob_180d: number;
  prob_365d: number;
  sample_size: number;
  confidence_label: ConfidenceLabel;
}

/** Threshold below which no prediction is surfaced (not enough data). */
export const MIN_SAMPLE_SIZE = 10;

/** Confidence-label thresholds. */
export function deriveConfidenceLabel(sampleSize: number): ConfidenceLabel {
  if (sampleSize >= 500) return "high";
  if (sampleSize >= 50) return "medium";
  return "low";
}

/** Clamp probability to [0, 1] and round to 3 decimals (matches DB schema). */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return Math.round(p * 1000) / 1000;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Permit-cascade extraction
 *
 * Given an `address_permit_history` row's `permits` jsonb array (a list of
 * permit summaries with at least `trade` + `applied_date`), compute pairs:
 * (primary_trade, follow_on_trade, days_between).
 *
 * Used by the cron to build the historical model.
 * ────────────────────────────────────────────────────────────────────────── */

export interface PermitSummary {
  trade?: string | null;
  applied_date?: string | null;
  issued_date?: string | null;
}

export interface CascadePair {
  primary_trade: CanonicalTrade;
  follow_on_trade: CanonicalTrade;
  days_between: number;
}

/** Extract every (primary, follow_on, days) pair from a permit-history row's permits array. */
export function extractCascadePairs(permits: PermitSummary[]): CascadePair[] {
  const pairs: CascadePair[] = [];
  if (!Array.isArray(permits) || permits.length < 2) return pairs;

  // Sort by date so we always look forward
  const dated = permits
    .map((p) => {
      const date = p.applied_date ?? p.issued_date ?? null;
      const trade = normalizeTrade(p.trade);
      if (!date || !trade) return null;
      return { date: new Date(date), trade };
    })
    .filter((p): p is { date: Date; trade: CanonicalTrade } => p !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (a.trade === b.trade) continue; // Same trade isn't a "cascade" — it's a re-pull
      const daysBetween = Math.round(
        (b.date.getTime() - a.date.getTime()) / (1000 * 60 * 60 * 24),
      );
      // Cap the look-ahead window at 365 days
      if (daysBetween > 365) break;
      pairs.push({
        primary_trade: a.trade,
        follow_on_trade: b.trade,
        days_between: daysBetween,
      });
    }
  }
  return pairs;
}

/** Normalize a free-text trade string to one of the 7 canonical trades, or null. */
export function normalizeTrade(trade: string | null | undefined): CanonicalTrade | null {
  if (!trade || typeof trade !== "string") return null;
  const lower = trade.toLowerCase().trim();
  if ((CANONICAL_TRADES as readonly string[]).includes(lower)) {
    return lower as CanonicalTrade;
  }
  // Common aliases — order matters: more-specific patterns must come
  // BEFORE less-specific ones. "water heater" contains "heat" (hvac trigger)
  // but is canonically plumbing; check plumbing first so it wins.
  if (/roof/i.test(lower)) return "roofing";
  if (/plumb|water heater|drain|pipe/i.test(lower)) return "plumbing";
  if (/hvac|furnace|ac\b|air condition|heat pump|heating system|cooling system/i.test(lower)) return "hvac";
  if (/electric|wiring|panel|outlet/i.test(lower)) return "electrical";
  if (/solar|pv\b|photovoltaic/i.test(lower)) return "solar";
  if (/\badu\b|accessory dwelling/i.test(lower)) return "adu";
  if (/remodel|renovation|addition|kitchen|bath/i.test(lower)) return "general remodel";
  return null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Probability computation
 *
 * Given a (primary_trade, follow_on_trade) bucket and a list of historical
 * cascade pairs, compute the 90/180/365-day probabilities.
 * ────────────────────────────────────────────────────────────────────────── */

export interface ProbabilityBucket {
  total: number;
  within_90d: number;
  within_180d: number;
  within_365d: number;
}

/** Aggregate cascade pairs by (primary_trade, follow_on_trade). */
export function aggregateBuckets(
  pairs: CascadePair[],
): Map<string, ProbabilityBucket> {
  const buckets = new Map<string, ProbabilityBucket>();
  for (const p of pairs) {
    const key = `${p.primary_trade}::${p.follow_on_trade}`;
    const bucket = buckets.get(key) ?? {
      total: 0,
      within_90d: 0,
      within_180d: 0,
      within_365d: 0,
    };
    bucket.total += 1;
    if (p.days_between <= 90) bucket.within_90d += 1;
    if (p.days_between <= 180) bucket.within_180d += 1;
    if (p.days_between <= 365) bucket.within_365d += 1;
    buckets.set(key, bucket);
  }
  return buckets;
}

/** Convert raw bucket counts to probabilities, with sample-size threshold. */
export function bucketsToPredictions(
  buckets: Map<string, ProbabilityBucket>,
  primaryTradeCounts: Map<CanonicalTrade, number>,
): Array<{
  primary_trade: CanonicalTrade;
  predicted_trade: CanonicalTrade;
  prob_90d: number;
  prob_180d: number;
  prob_365d: number;
  sample_size: number;
  confidence_label: ConfidenceLabel;
}> {
  const out: Array<{
    primary_trade: CanonicalTrade;
    predicted_trade: CanonicalTrade;
    prob_90d: number;
    prob_180d: number;
    prob_365d: number;
    sample_size: number;
    confidence_label: ConfidenceLabel;
  }> = [];

  for (const [key, bucket] of buckets.entries()) {
    const [primary, predicted] = key.split("::") as [CanonicalTrade, CanonicalTrade];
    // Sample size = total properties that filed `primary` and could have
    // followed up with `predicted`. Use the number of primary occurrences,
    // not just the bucket total (so absence-of-follow-on counts).
    const sampleSize = primaryTradeCounts.get(primary) ?? bucket.total;
    if (sampleSize < MIN_SAMPLE_SIZE) continue;

    out.push({
      primary_trade: primary,
      predicted_trade: predicted,
      prob_90d: clampProbability(bucket.within_90d / sampleSize),
      prob_180d: clampProbability(bucket.within_180d / sampleSize),
      prob_365d: clampProbability(bucket.within_365d / sampleSize),
      sample_size: sampleSize,
      confidence_label: deriveConfidenceLabel(sampleSize),
    });
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Read API — used by the dashboard
 * ────────────────────────────────────────────────────────────────────────── */

/** Fetch all cascade predictions for a single lead, ordered by 90d prob desc. */
export async function getCascadePredictionsForLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<CascadePrediction[]> {
  const { data, error } = await supabase
    .from("cascade_predictions")
    .select("predicted_trade, prob_90d, prob_180d, prob_365d, sample_size, confidence_label")
    .eq("lead_id", leadId)
    .order("prob_90d", { ascending: false });

  if (error) {
    // Graceful-degrade: return empty array rather than crash the drawer.
    // The drawer won't render the panel if the array is empty.
    return [];
  }
  return (data ?? []) as CascadePrediction[];
}
