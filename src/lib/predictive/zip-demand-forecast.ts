/* ── F2.4 — ZIP demand 30-day forecast ──────────────────────────────────
 *
 *  Tier A+ Sprint 2. Produces a 30-day-ahead forecast of permit-filing
 *  activity per ZIP using simple exponential smoothing on the existing
 *  weekly counts. NO LLM, NO PII.
 *
 *  Input: time-ordered weekly permit counts per ZIP from the existing
 *  zip_demand_scores history (or computed inline from the permits table).
 *  Output: 4-week-ahead forecast + confidence interval.
 *
 *  Compliance: forecasts construction activity in a ZIP — public-data
 *  analytics, not a consumer-impacting decision.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DemandForecast {
  /** Predicted permit count over the next 30 days */
  predicted_30d: number;
  /** Predicted permit count over the next 7 days */
  predicted_7d: number;
  /** Direction relative to the trailing 30-day baseline */
  trend: "increasing" | "decreasing" | "stable";
  /** Trend strength: ratio of forecast vs. baseline */
  trend_factor: number;
  /** Number of weeks of history used */
  history_weeks: number;
  /** Confidence label */
  confidence: "low" | "medium" | "high";
}

/* ──────────────────────────────────────────────────────────────────────────
 * Simple exponential smoothing (SES)
 *
 * y_hat[t+1] = α × y[t] + (1-α) × y_hat[t]
 *
 * α = 0.3 is a moderate smoothing factor. Higher = more responsive to
 * recent changes; lower = more stable. 0.3 is a defensible default for
 * weekly count series.
 * ────────────────────────────────────────────────────────────────────────── */

const SMOOTHING_ALPHA = 0.3;

/** Compute the SES one-step-ahead forecast given a weekly history. */
export function smoothedForecast(
  weeklyCounts: number[],
  alpha: number = SMOOTHING_ALPHA,
): number {
  if (!Array.isArray(weeklyCounts) || weeklyCounts.length === 0) return 0;
  if (weeklyCounts.length === 1) return weeklyCounts[0];

  let smoothed = weeklyCounts[0];
  for (let i = 1; i < weeklyCounts.length; i++) {
    smoothed = alpha * weeklyCounts[i] + (1 - alpha) * smoothed;
  }
  return smoothed;
}

/** Compute a 30-day forecast (= 4 × 1-week forecast assuming flat smoothing). */
export function forecast30Days(weeklyCounts: number[]): number {
  const oneWeek = smoothedForecast(weeklyCounts);
  return Math.round(oneWeek * 4.286); // 30/7
}

/** Compute trend by comparing the late-half mean vs. the early-half mean
 * of the time series. SES forecast lags growing trends, so comparing
 * forecast-vs-baseline produces the wrong sign for fast-growing series.
 * Halves comparison is more robust + matches user intuition.
 *
 * `forecastWeekly` is accepted for the no-history zero-baseline case
 * (we still want a positive trend signal when we have a forecast). */
export function deriveTrend(
  weeklyCounts: number[],
  forecastWeekly: number,
): { trend: "increasing" | "decreasing" | "stable"; trend_factor: number } {
  if (weeklyCounts.length < 4) {
    return { trend: "stable", trend_factor: 1 };
  }
  const half = Math.floor(weeklyCounts.length / 2);
  const earlyMean =
    weeklyCounts.slice(0, half).reduce((sum, n) => sum + n, 0) / half;
  const lateMean =
    weeklyCounts.slice(half).reduce((sum, n) => sum + n, 0) /
    (weeklyCounts.length - half);

  if (earlyMean === 0) {
    if (lateMean > 0 || forecastWeekly > 0) {
      return { trend: "increasing", trend_factor: lateMean || forecastWeekly };
    }
    return { trend: "stable", trend_factor: 1 };
  }

  const factor = lateMean / earlyMean;
  const rounded = Math.round(factor * 1000) / 1000;
  if (factor >= 1.15) return { trend: "increasing", trend_factor: rounded };
  if (factor <= 0.85) return { trend: "decreasing", trend_factor: rounded };
  return { trend: "stable", trend_factor: rounded };
}

/** Confidence based on history length. */
export function deriveDemandConfidence(historyWeeks: number): "low" | "medium" | "high" {
  if (historyWeeks >= 26) return "high";
  if (historyWeeks >= 12) return "medium";
  return "low";
}

/** Build a complete forecast from a weekly history array. */
export function buildDemandForecast(weeklyCounts: number[]): DemandForecast {
  const oneWeek = smoothedForecast(weeklyCounts);
  const thirtyDay = forecast30Days(weeklyCounts);
  const { trend, trend_factor } = deriveTrend(weeklyCounts, oneWeek);

  return {
    predicted_30d: thirtyDay,
    predicted_7d: Math.round(oneWeek),
    trend,
    trend_factor,
    history_weeks: weeklyCounts.length,
    confidence: deriveDemandConfidence(weeklyCounts.length),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helper: bucket permit timestamps into weekly counts
 * ────────────────────────────────────────────────────────────────────────── */

/** Bucket a list of ISO dates into weekly counts. The current week
 * (Sunday→Saturday containing today) is the LAST bucket; weeks older
 * occupy earlier indices. */
export function bucketIntoWeeks(
  isoDates: Array<string | null | undefined>,
  windowWeeks: number = 26,
): number[] {
  const now = new Date();
  // Snap to NEXT Sunday 00:00 UTC (the start of the week AFTER the
  // current one). Using next Sunday as the anchor makes the current
  // week's dates produce weeksAgo=0 → most-recent bucket.
  const day = now.getUTCDay();
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + (7 - day));
  nextSunday.setUTCHours(0, 0, 0, 0);

  const buckets = new Array(windowWeeks).fill(0);
  for (const iso of isoDates) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) continue;
    const weeksAgo = Math.floor(
      (nextSunday.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    if (weeksAgo < 0 || weeksAgo >= windowWeeks) continue;
    // Most-recent week is at index windowWeeks-1
    buckets[windowWeeks - 1 - weeksAgo] += 1;
  }
  return buckets;
}
