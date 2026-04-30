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
