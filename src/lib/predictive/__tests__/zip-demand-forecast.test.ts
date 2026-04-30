/* ── zip-demand-forecast.test.ts ────────────────────────────────────────
 *
 *  Tier A+ Sprint 2 — F2.4 ZIP demand forecast tests.
 * ──────────────────────────────────────────────────────────────────────── */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketIntoWeeks,
  buildDemandForecast,
  deriveDemandConfidence,
  deriveTrend,
  forecast30Days,
  smoothedForecast,
} from "../zip-demand-forecast";

describe("smoothedForecast", () => {
  it("returns 0 on empty", () => {
    expect(smoothedForecast([])).toBe(0);
  });
  it("returns the value for single-element", () => {
    expect(smoothedForecast([10])).toBe(10);
  });
  it("converges toward recent values", () => {
    // Series: increasing 1..10. SES with alpha=0.3 should be biased toward recent.
    const result = smoothedForecast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Final value > simple average (which would be 5.5)
    expect(result).toBeGreaterThan(5.5);
    // But less than the latest (10)
    expect(result).toBeLessThan(10);
  });
  it("honors custom alpha", () => {
    const series = [1, 2, 3, 4, 5];
    const alpha09 = smoothedForecast(series, 0.9);
    const alpha01 = smoothedForecast(series, 0.1);
    // Higher alpha → more responsive to recent values
    expect(alpha09).toBeGreaterThan(alpha01);
  });
});

describe("forecast30Days", () => {
  it("scales 1-week forecast to ~30 days", () => {
    // SES on flat series of 5 → smoothed ~5; 30d forecast ~21
    const flat = [5, 5, 5, 5, 5, 5, 5, 5];
    const forecast = forecast30Days(flat);
    expect(forecast).toBeGreaterThanOrEqual(20);
    expect(forecast).toBeLessThanOrEqual(22);
  });
  it("returns 0 for empty input", () => {
    expect(forecast30Days([])).toBe(0);
  });
});

describe("deriveTrend", () => {
  it("returns 'stable' on insufficient history", () => {
    expect(deriveTrend([5, 5], 5)).toEqual({ trend: "stable", trend_factor: 1 });
  });
  it("returns 'increasing' when late-half mean is meaningfully higher than early-half", () => {
    // Early half: [10, 10] mean=10. Late half: [13, 13] mean=13. Factor 1.3.
    const result = deriveTrend([10, 10, 13, 13], 13);
    expect(result.trend).toBe("increasing");
    expect(result.trend_factor).toBe(1.3);
  });
  it("returns 'decreasing' when late-half mean is meaningfully lower", () => {
    // Early half: [10, 10] mean=10. Late half: [7, 7] mean=7. Factor 0.7.
    const result = deriveTrend([10, 10, 7, 7], 7);
    expect(result.trend).toBe("decreasing");
    expect(result.trend_factor).toBe(0.7);
  });
  it("returns 'stable' for small deviations between halves", () => {
    expect(deriveTrend([10, 10, 11, 11], 11).trend).toBe("stable");
    expect(deriveTrend([10, 10, 9, 9], 9).trend).toBe("stable");
    expect(deriveTrend([10, 10, 10, 10], 10).trend).toBe("stable");
  });
  it("handles zero baseline correctly", () => {
    const result = deriveTrend([0, 0, 0, 0], 5);
    expect(result.trend).toBe("increasing");
  });
});

describe("deriveDemandConfidence", () => {
  it("returns labels at documented thresholds", () => {
    expect(deriveDemandConfidence(11)).toBe("low");
    expect(deriveDemandConfidence(12)).toBe("medium");
    expect(deriveDemandConfidence(25)).toBe("medium");
    expect(deriveDemandConfidence(26)).toBe("high");
    expect(deriveDemandConfidence(52)).toBe("high");
  });
});

describe("buildDemandForecast", () => {
  it("returns sensible forecast on stable history", () => {
    const flat = Array(26).fill(10);
    const forecast = buildDemandForecast(flat);
    expect(forecast.predicted_7d).toBeCloseTo(10, 0);
    expect(forecast.predicted_30d).toBeGreaterThan(40);
    expect(forecast.predicted_30d).toBeLessThan(46);
    expect(forecast.trend).toBe("stable");
    expect(forecast.confidence).toBe("high");
    expect(forecast.history_weeks).toBe(26);
  });
  it("flags 'increasing' trend on growing history", () => {
    const growing = Array.from({ length: 20 }, (_, i) => i + 5);
    const forecast = buildDemandForecast(growing);
    expect(forecast.trend).toBe("increasing");
  });
});

describe("bucketIntoWeeks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00Z")); // Thursday
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns array of correct length", () => {
    const result = bucketIntoWeeks([], 26);
    expect(result.length).toBe(26);
    expect(result.every((n) => n === 0)).toBe(true);
  });
  it("buckets recent dates into the last bucket", () => {
    // 2026-04-30 is Thursday → this Sunday was 2026-04-26
    // A date today should land in the most-recent week (index = windowWeeks - 1)
    const result = bucketIntoWeeks(["2026-04-29"], 26);
    expect(result[25]).toBe(1);
  });
  it("ignores dates outside the window", () => {
    // 1 year ago should be outside a 26-week window
    const result = bucketIntoWeeks(["2024-04-29"], 26);
    expect(result.every((n) => n === 0)).toBe(true);
  });
  it("ignores invalid dates", () => {
    const result = bucketIntoWeeks(["not a date", null, undefined], 4);
    expect(result.every((n) => n === 0)).toBe(true);
  });
});
