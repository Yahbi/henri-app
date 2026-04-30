/* ── F2.1 — Storm-damage opportunity prediction ─────────────────────────
 *
 *  Tier A+ Sprint 1. Predicts repair-likelihood per lead based on recent
 *  NOAA storm events at the lead's ZIP. Deterministic statistical query —
 *  NO LLM, NO PII.
 *
 *  Logic:
 *    1. Look up storm_events at lead.zip in the last 60 days.
 *    2. For each (ZIP × event_type) pair, compute historical
 *       post-storm-permit-pull rate within 60 / 90 days.
 *    3. Multiply event recency × historical rate to get a likelihood score.
 *
 *  Cached in `storm_predictions` table; refreshed weekly by the cron.
 *  Surfaces as a "storm-impacted" badge + map overlay.
 *
 *  Reference: src/types/database.ts → public.storm_events.
 * ──────────────────────────────────────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveConfidenceLabel, type ConfidenceLabel } from "./cascade";

/** Event types that historically drive repair-permit pulls. */
export const REPAIR_DRIVING_EVENTS = [
  "Hail",
  "Tornado",
  "Thunderstorm Wind",
  "High Wind",
  "Heavy Rain",
  "Flash Flood",
  "Flood",
  "Hurricane",
  "Tropical Storm",
  "Wildfire",
  "Ice Storm",
  "Heavy Snow",
  "Winter Storm",
] as const;

export type RepairDrivingEvent = (typeof REPAIR_DRIVING_EVENTS)[number];

export interface StormPrediction {
  storm_event_count_60d: number;
  last_storm_date: string | null; // ISO date
  max_magnitude: number | null;
  primary_event_type: string | null;
  repair_likelihood_60d: number;
  repair_likelihood_90d: number;
  sample_size: number;
  confidence_label: ConfidenceLabel;
}

/** Threshold below which no prediction is surfaced (no storm activity). */
export const NO_STORMS_PREDICTION: StormPrediction = {
  storm_event_count_60d: 0,
  last_storm_date: null,
  max_magnitude: null,
  primary_event_type: null,
  repair_likelihood_60d: 0,
  repair_likelihood_90d: 0,
  sample_size: 0,
  confidence_label: "low",
};

/* ──────────────────────────────────────────────────────────────────────────
 * Score derivation
 *
 * Given a list of storm events at a ZIP and a historical post-storm rate,
 * compute the repair likelihood. The model:
 *
 *   likelihood_60d = min(1, historical_60d_rate × event_recency_weight)
 *
 * where event_recency_weight is:
 *   - 1.0 if the most recent event is within 14 days
 *   - 0.7 if 15-30 days ago
 *   - 0.4 if 31-60 days ago
 *   - 0.0 if > 60 days ago
 *
 * historical_60d_rate is computed elsewhere (in the cron) by joining
 * storm_events to permits filed within 60 days of the storm in the same
 * ZIP. This gives a per-(ZIP, event_type) baseline.
 * ────────────────────────────────────────────────────────────────────────── */

export interface StormEvent {
  begin_date: string;
  event_type: string;
  magnitude?: number | null;
}

/** Compute the recency weight for the most-recent storm event. */
export function recencyWeight(daysAgo: number): number {
  if (daysAgo <= 14) return 1.0;
  if (daysAgo <= 30) return 0.7;
  if (daysAgo <= 60) return 0.4;
  return 0;
}

/** Pick the predominant event type from a list of storms (mode). */
export function predominantEventType(events: StormEvent[]): string | null {
  if (events.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.event_type, (counts.get(e.event_type) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/** Compute the max magnitude across a list of storm events. Null-safe. */
export function maxMagnitude(events: StormEvent[]): number | null {
  let max: number | null = null;
  for (const e of events) {
    if (e.magnitude == null) continue;
    if (max == null || e.magnitude > max) max = e.magnitude;
  }
  return max;
}

/** Days between an ISO date and now. Negative if in the future. */
export function daysAgo(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

/** Build a StormPrediction from a list of recent storms + historical rates. */
export function buildStormPrediction(
  events: StormEvent[],
  historicalRate60d: number,
  historicalRate90d: number,
  sampleSize: number,
): StormPrediction {
  if (events.length === 0) return NO_STORMS_PREDICTION;

  // Most recent storm
  const sorted = [...events].sort(
    (a, b) => new Date(b.begin_date).getTime() - new Date(a.begin_date).getTime(),
  );
  const mostRecent = sorted[0];
  const recency = recencyWeight(daysAgo(mostRecent.begin_date));

  return {
    storm_event_count_60d: events.length,
    last_storm_date: mostRecent.begin_date,
    max_magnitude: maxMagnitude(events),
    primary_event_type: predominantEventType(events),
    repair_likelihood_60d: clampLikelihood(historicalRate60d * recency),
    repair_likelihood_90d: clampLikelihood(historicalRate90d * recency),
    sample_size: sampleSize,
    confidence_label: deriveConfidenceLabel(sampleSize),
  };
}

function clampLikelihood(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return Math.round(p * 1000) / 1000;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Historical-rate computation
 *
 * Per-event-type baseline. For each repair-driving event type, look at
 * storms that occurred 60 days to 2 years ago (old enough to observe
 * follow-on permit behaviour, recent enough to remain relevant), then
 * count what fraction had at least one permit filed within 60d / 90d in
 * the same ZIP. Returns a Map<event_type → {rate60d, rate90d, sampleSize}>.
 *
 * Sample-size threshold: events with < MIN_HISTORICAL_SAMPLE storms in the
 * window are treated as "no signal" — rates default to 0, and the UI
 * hides the storm panel for leads in those event types. This is the
 * honest path: when we don't have data, we don't fabricate a rate.
 *
 * Called once per cron run (weekly) — output is cached in memory and
 * applied to every lead's storm prediction in the same run. NO PII —
 * only ZIP + permit applied_date are read.
 * ────────────────────────────────────────────────────────────────────────── */

export interface HistoricalRate {
  rate60d: number;
  rate90d: number;
  sampleSize: number;
}

export const NO_HISTORICAL_RATE: HistoricalRate = { rate60d: 0, rate90d: 0, sampleSize: 0 };

/** Minimum storm-event sample to treat the historical rate as meaningful. */
export const MIN_HISTORICAL_SAMPLE = 10;
/** Cap per event-type to bound cron cost. */
export const MAX_HISTORICAL_SAMPLE = 200;

export interface ComputeRatesOptions {
  /** Soft deadline (epoch ms). Function bails early if exceeded. */
  deadline?: number;
  /** Override sample cap (default MAX_HISTORICAL_SAMPLE). */
  maxSamplePerType?: number;
  /** Override the look-back floor (default 730 days). */
  lookbackDays?: number;
}

/** Compute the historical post-storm permit-pull rate per event type.
 *
 *  Strategy: pull a sample of storms 60d-2y old per event type, then for
 *  each storm count whether any permit was filed at the same ZIP within
 *  60/90 days. Rate = storms_with_permit_within_window / total_storms.
 *
 *  Returns a Map keyed on the canonical event type name. Event types
 *  with too-small samples map to NO_HISTORICAL_RATE so the cron renders
 *  zero likelihood (graceful-degrade).
 */
export async function computeStormHistoricalRates(
  supabase: SupabaseClient,
  options: ComputeRatesOptions = {},
): Promise<Map<string, HistoricalRate>> {
  const result = new Map<string, HistoricalRate>();
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const maxSample = options.maxSamplePerType ?? MAX_HISTORICAL_SAMPLE;
  const lookbackDays = options.lookbackDays ?? 730;

  const twoYearsAgo = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const sixtyDaysAgoOutcome = new Date(Date.now() - 60 * 86_400_000).toISOString();

  for (const eventType of REPAIR_DRIVING_EVENTS) {
    if (Date.now() > deadline) break;

    // Pull a sample of storms of this type that are old enough to have
    // observable follow-on permits. Filter to rows with a non-null ZIP
    // since we join on it.
    const { data: storms } = await supabase
      .from("storm_events")
      .select("zip, begin_date")
      .eq("event_type", eventType)
      .lte("begin_date", sixtyDaysAgoOutcome)
      .gte("begin_date", twoYearsAgo)
      .not("zip", "is", null)
      .limit(maxSample);

    if (!storms || storms.length < MIN_HISTORICAL_SAMPLE) {
      result.set(eventType, { ...NO_HISTORICAL_RATE, sampleSize: storms?.length ?? 0 });
      continue;
    }

    let withPermit60 = 0;
    let withPermit90 = 0;

    for (const storm of storms) {
      if (Date.now() > deadline) break;
      const startIso = storm.begin_date as string;
      const startMs = new Date(startIso).getTime();
      if (!Number.isFinite(startMs)) continue;
      const end60 = new Date(startMs + 60 * 86_400_000).toISOString();
      const end90 = new Date(startMs + 90 * 86_400_000).toISOString();

      // Single round-trip per storm per window. count='exact', head=true
      // returns just the count without the rows. With the
      // (state, zip, begin_date) index on storm_events and the (zip, applied_date)
      // index on permits, each query is single-digit ms.
      const [c60Res, c90Res] = await Promise.all([
        supabase
          .from("permits")
          .select("id", { count: "exact", head: true })
          .eq("zip", storm.zip as string)
          .gte("applied_date", startIso)
          .lte("applied_date", end60),
        supabase
          .from("permits")
          .select("id", { count: "exact", head: true })
          .eq("zip", storm.zip as string)
          .gte("applied_date", startIso)
          .lte("applied_date", end90),
      ]);
      if ((c60Res.count ?? 0) > 0) withPermit60++;
      if ((c90Res.count ?? 0) > 0) withPermit90++;
    }

    result.set(eventType, {
      rate60d: withPermit60 / storms.length,
      rate90d: withPermit90 / storms.length,
      sampleSize: storms.length,
    });
  }

  return result;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Read API — used by the dashboard
 * ────────────────────────────────────────────────────────────────────────── */

/** Fetch the storm prediction for a single lead. Returns null if no row. */
export async function getStormPredictionForLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<StormPrediction | null> {
  const { data, error } = await supabase
    .from("storm_predictions")
    .select(
      "storm_event_count_60d, last_storm_date, max_magnitude, primary_event_type, repair_likelihood_60d, repair_likelihood_90d, sample_size, confidence_label",
    )
    .eq("lead_id", leadId)
    .maybeSingle();

  if (error || !data) {
    // Graceful-degrade: no row means no storms in window. UI hides panel.
    return null;
  }
  return data as StormPrediction;
}
