/* ── F2.2 — Permit value forecasting ────────────────────────────────────
 *
 *  Tier A+ Sprint 2. ~70% of permits have no `estimated_value`. This
 *  module predicts the missing value using simple statistical regression
 *  on (permit_type × ZIP × year_built × assessed_value) buckets.
 *
 *  Approach: deterministic per-bucket median + IQR. No external ML, no
 *  LLM, no PII. Predictions are surfaced as a fallback `permit_value_predicted`
 *  alongside the actual `estimated_value` when available.
 *
 *  Compliance: predicts about THE PROPERTY (public asset), not about any
 *  consumer. No FHA/credit/employment decision.
 * ──────────────────────────────────────────────────────────────────────── */

export interface ValueForecastInput {
  permit_type: string | null;
  zip: string | null;
  year_built?: number | null;
  assessed_value?: number | null;
}

export interface ValueForecast {
  predicted_value: number;
  confidence: "low" | "medium" | "high";
  /** The bucket key used for prediction (for debuggability). */
  bucket_key: string;
  /** How many historical permits backed the prediction. */
  sample_size: number;
}

/** Year-built bucket: pre-1950, 1950-79, 1980-99, 2000-09, 2010+ */
export function yearBuiltBucket(year: number | null | undefined): string {
  if (year == null || !Number.isFinite(year)) return "unknown";
  if (year < 1950) return "pre1950";
  if (year < 1980) return "1950-79";
  if (year < 2000) return "1980-99";
  if (year < 2010) return "2000-09";
  return "2010+";
}

/** ZIP bucket: first 3 digits (sectional center) — preserves region while
 * keeping bucket size large enough for sample. Falls back to "unknown". */
export function zipBucket(zip: string | null | undefined): string {
  if (!zip || typeof zip !== "string") return "unknown";
  const digits = zip.replace(/\D/g, "").slice(0, 3);
  return digits.length === 3 ? digits : "unknown";
}

/** Normalize permit_type to a small set of canonical buckets. */
export function permitTypeBucket(type: string | null | undefined): string {
  if (!type || typeof type !== "string") return "unknown";
  const lower = type.toLowerCase().trim();
  if (/residential|single family|sfr/i.test(lower)) return "residential";
  if (/commercial/i.test(lower)) return "commercial";
  if (/roof/i.test(lower)) return "roofing";
  if (/hvac|mechanical|heat|cool|air condition/i.test(lower)) return "hvac";
  if (/plumb/i.test(lower)) return "plumbing";
  if (/electric/i.test(lower)) return "electrical";
  if (/solar|pv\b/i.test(lower)) return "solar";
  if (/remodel|renovation|kitchen|bath/i.test(lower)) return "remodel";
  if (/addition/i.test(lower)) return "addition";
  if (/pool/i.test(lower)) return "pool";
  if (/demolition|demo\b/i.test(lower)) return "demolition";
  return "other";
}

/** Build a stable bucket key: type|zip3|yearBucket. */
export function buildBucketKey(input: ValueForecastInput): string {
  return [
    permitTypeBucket(input.permit_type),
    zipBucket(input.zip),
    yearBuiltBucket(input.year_built),
  ].join("|");
}

/** Compute median of a numeric array. Returns null on empty. */
export function median(values: number[]): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Compute IQR (Q3 - Q1). Returns null on empty. */
export function iqr(values: number[]): number | null {
  if (!Array.isArray(values) || values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return q3 - q1;
}

/** Confidence label from sample size. Mirrors cascade convention. */
export function deriveValueConfidence(sampleSize: number): "low" | "medium" | "high" {
  if (sampleSize >= 100) return "high";
  if (sampleSize >= 20) return "medium";
  return "low";
}

/* ──────────────────────────────────────────────────────────────────────────
 * Forecast computation
 *
 * Given a target permit's bucket key + a model (Map<bucketKey, [values]>),
 * produce a prediction. Falls back to broader buckets if the specific
 * bucket has too few samples.
 * ────────────────────────────────────────────────────────────────────────── */

export interface ValueModel {
  buckets: Map<string, number[]>;
}

/** Produce a forecast from a model + a target permit's bucket key. */
export function forecastValue(
  input: ValueForecastInput,
  model: ValueModel,
): ValueForecast | null {
  const key = buildBucketKey(input);

  // Try the most-specific bucket first
  const specific = model.buckets.get(key) ?? [];
  if (specific.length >= 5) {
    const m = median(specific);
    if (m !== null) {
      return {
        predicted_value: Math.round(m),
        confidence: deriveValueConfidence(specific.length),
        bucket_key: key,
        sample_size: specific.length,
      };
    }
  }

  // Fallback: drop year bucket (type|zip)
  const fallback1Key = `${permitTypeBucket(input.permit_type)}|${zipBucket(input.zip)}|*`;
  const fallback1Values: number[] = [];
  for (const [k, v] of model.buckets) {
    if (k.startsWith(`${permitTypeBucket(input.permit_type)}|${zipBucket(input.zip)}|`)) {
      fallback1Values.push(...v);
    }
  }
  if (fallback1Values.length >= 5) {
    const m = median(fallback1Values);
    if (m !== null) {
      return {
        predicted_value: Math.round(m),
        confidence: deriveValueConfidence(fallback1Values.length),
        bucket_key: fallback1Key,
        sample_size: fallback1Values.length,
      };
    }
  }

  // Last resort: just by permit type
  const fallback2Key = `${permitTypeBucket(input.permit_type)}|*|*`;
  const fallback2Values: number[] = [];
  for (const [k, v] of model.buckets) {
    if (k.startsWith(`${permitTypeBucket(input.permit_type)}|`)) {
      fallback2Values.push(...v);
    }
  }
  if (fallback2Values.length >= 5) {
    const m = median(fallback2Values);
    if (m !== null) {
      return {
        predicted_value: Math.round(m),
        confidence: "low", // Always low when we've fallen back to type-only
        bucket_key: fallback2Key,
        sample_size: fallback2Values.length,
      };
    }
  }

  return null;
}

/** Build a model from a list of training samples. */
export function buildValueModel(
  samples: Array<{ permit_type: string | null; zip: string | null; year_built: number | null; estimated_value: number }>,
): ValueModel {
  const buckets = new Map<string, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.estimated_value) || s.estimated_value <= 0) continue;
    const key = buildBucketKey({
      permit_type: s.permit_type,
      zip: s.zip,
      year_built: s.year_built,
    });
    const arr = buckets.get(key) ?? [];
    arr.push(s.estimated_value);
    buckets.set(key, arr);
  }
  return { buckets };
}
