/* ── F2.5 — Permit-aging anomaly detection ──────────────────────────────
 *
 *  Tier A+ Sprint 1. Flags permits where the gap between applied_date
 *  and issued_date is unusually long for the issuing jurisdiction —
 *  suggesting a stuck application. Surfaces as a "stuck permit" badge in
 *  the dashboard, opportunity for a contractor to outreach the homeowner
 *  with "let me help unstick this."
 *
 *  Logic:
 *    1. For each (jurisdiction = city + state, permit_type) bucket,
 *       compute p95 of applied_to_issued_gap_days from the historical
 *       corpus.
 *    2. A permit is flagged anomalous if its gap > p95 AND > 30 days.
 *    3. anomaly_score = actual_gap / p95_gap, capped at 10.
 *
 *  Cached in `permit_anomalies` table; refreshed weekly by the cron.
 *
 *  Tier A+ compliance: aggregates public permit timestamps. NO PII.
 * ──────────────────────────────────────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PermitAnomaly {
  jurisdiction_key: string;
  applied_to_issued_gap_days: number | null;
  jurisdiction_p95_gap_days: number | null;
  anomaly_score: number;
  is_stuck: boolean;
}

/** Threshold gap below which a permit is never considered stuck (regardless of jurisdiction p95). */
export const MIN_GAP_TO_BE_STUCK_DAYS = 30;

/** Cap on anomaly_score to avoid extreme outliers skewing the UI. */
export const MAX_ANOMALY_SCORE = 10;

/** Build a stable jurisdiction key from city + state. */
export function buildJurisdictionKey(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  const c = (city ?? "").toLowerCase().trim();
  const s = (state ?? "").toLowerCase().trim();
  return `${c}|${s}`;
}

/** Compute the gap in days between two ISO dates. Returns null if either is null/invalid. */
export function computeGapDays(
  appliedDate: string | null | undefined,
  issuedDate: string | null | undefined,
): number | null {
  if (!appliedDate || !issuedDate) return null;
  const a = new Date(appliedDate).getTime();
  const b = new Date(issuedDate).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) return 0; // Future-dated or out-of-order — treat as 0
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

/* ──────────────────────────────────────────────────────────────────────────
 * Per-jurisdiction p95 computation
 *
 * Given an array of historical (jurisdiction, gap_days) pairs, compute
 * the p95 threshold per jurisdiction. Used by the cron to build the
 * benchmark that incoming permits are compared against.
 * ────────────────────────────────────────────────────────────────────────── */

/** Compute p95 of a numeric array. Returns null for empty/invalid input. */
export function computeP95(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)] ?? null;
}

/** Build a per-jurisdiction p95 map from historical gap data. */
export function buildJurisdictionP95(
  rows: Array<{ jurisdiction_key: string; gap_days: number }>,
): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (typeof row.gap_days !== "number" || row.gap_days < 0) continue;
    const arr = grouped.get(row.jurisdiction_key) ?? [];
    arr.push(row.gap_days);
    grouped.set(row.jurisdiction_key, arr);
  }
  const p95Map = new Map<string, number>();
  for (const [key, gaps] of grouped) {
    const p95 = computeP95(gaps);
    if (p95 !== null) p95Map.set(key, p95);
  }
  return p95Map;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Anomaly classification
 *
 * Given a single permit's gap + jurisdiction p95, decide if it's stuck.
 * ────────────────────────────────────────────────────────────────────────── */

/** Classify a permit as anomalous (stuck) or not. */
export function classifyAnomaly(
  gapDays: number | null,
  p95Days: number | null,
): {
  anomaly_score: number;
  is_stuck: boolean;
} {
  if (gapDays == null || p95Days == null) {
    return { anomaly_score: 0, is_stuck: false };
  }
  if (gapDays < MIN_GAP_TO_BE_STUCK_DAYS) {
    return { anomaly_score: 0, is_stuck: false };
  }
  if (p95Days <= 0) {
    // Jurisdiction has no historical data; can't classify
    return { anomaly_score: 0, is_stuck: false };
  }
  const ratio = gapDays / p95Days;
  const score = Math.min(MAX_ANOMALY_SCORE, Math.round(ratio * 100) / 100);
  // Stuck = above the jurisdiction's p95 AND above the absolute floor
  const isStuck = ratio > 1.0;
  return { anomaly_score: score, is_stuck: isStuck };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Read API — used by the dashboard
 * ────────────────────────────────────────────────────────────────────────── */

/** Fetch the anomaly record for a single permit. Returns null if no row or not stuck. */
export async function getAnomalyForPermit(
  supabase: SupabaseClient,
  permitId: string,
): Promise<PermitAnomaly | null> {
  const { data, error } = await supabase
    .from("permit_anomalies")
    .select(
      "jurisdiction_key, applied_to_issued_gap_days, jurisdiction_p95_gap_days, anomaly_score, is_stuck",
    )
    .eq("permit_id", permitId)
    .maybeSingle();

  if (error || !data) return null;
  // Only return rows where is_stuck=true; the UI hides everything else
  if (!data.is_stuck) return null;
  return data as PermitAnomaly;
}
