/* ── anomaly.test.ts ────────────────────────────────────────────────────
 *
 *  Tier A+ Sprint 1 — F2.5 permit anomaly detection tests.
 *
 *  Locks the invariants:
 *    1. computeGapDays handles null + invalid + future-dated cases.
 *    2. computeP95 returns the correct percentile or null on empty.
 *    3. buildJurisdictionP95 groups + computes p95 per jurisdiction.
 *    4. classifyAnomaly enforces MIN_GAP_TO_BE_STUCK_DAYS floor.
 *    5. classifyAnomaly returns is_stuck=true only when gap > p95 AND > 30d.
 *    6. anomaly_score is capped at MAX_ANOMALY_SCORE.
 * ──────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  MAX_ANOMALY_SCORE,
  MIN_GAP_TO_BE_STUCK_DAYS,
  buildJurisdictionKey,
  buildJurisdictionP95,
  classifyAnomaly,
  computeGapDays,
  computeP95,
} from "../anomaly";

describe("buildJurisdictionKey", () => {
  it("normalizes city + state to lowercase + trims", () => {
    expect(buildJurisdictionKey("Hartford", "CT")).toBe("hartford|ct");
    expect(buildJurisdictionKey("  San Francisco  ", "  CA  ")).toBe("san francisco|ca");
  });
  it("handles null/undefined gracefully", () => {
    expect(buildJurisdictionKey(null, "CT")).toBe("|ct");
    expect(buildJurisdictionKey("Hartford", null)).toBe("hartford|");
    expect(buildJurisdictionKey(null, null)).toBe("|");
  });
});

describe("computeGapDays", () => {
  it("returns null when either date is missing", () => {
    expect(computeGapDays(null, "2024-01-15")).toBe(null);
    expect(computeGapDays("2024-01-15", null)).toBe(null);
    expect(computeGapDays(null, null)).toBe(null);
    expect(computeGapDays(undefined, undefined)).toBe(null);
  });
  it("returns null for invalid dates", () => {
    expect(computeGapDays("not a date", "2024-01-15")).toBe(null);
  });
  it("returns 0 when issued_date is before applied_date (out-of-order)", () => {
    expect(computeGapDays("2024-04-15", "2024-01-15")).toBe(0);
  });
  it("computes the gap in whole days", () => {
    expect(computeGapDays("2024-01-01", "2024-01-15")).toBe(14);
    expect(computeGapDays("2024-01-01", "2024-04-01")).toBe(91);
  });
});

describe("computeP95", () => {
  it("returns null on empty input", () => {
    expect(computeP95([])).toBe(null);
  });
  it("returns the value at the 95th percentile index", () => {
    // 100 values 1..100; p95 = idx 95 (Math.floor(100 * 0.95)) = value 96
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(computeP95(values)).toBe(96);
  });
  it("works on small arrays", () => {
    expect(computeP95([10, 20, 30])).toBe(30); // idx 2
  });
  it("works on a single-value array", () => {
    expect(computeP95([42])).toBe(42);
  });
});

describe("buildJurisdictionP95", () => {
  it("groups by jurisdiction_key and computes p95 per group", () => {
    const rows = [
      { jurisdiction_key: "hartford|ct", gap_days: 10 },
      { jurisdiction_key: "hartford|ct", gap_days: 20 },
      { jurisdiction_key: "hartford|ct", gap_days: 100 },
      { jurisdiction_key: "los angeles|ca", gap_days: 50 },
      { jurisdiction_key: "los angeles|ca", gap_days: 70 },
    ];
    const map = buildJurisdictionP95(rows);
    expect(map.get("hartford|ct")).toBe(100);
    expect(map.get("los angeles|ca")).toBe(70);
  });
  it("ignores invalid gap values", () => {
    const rows = [
      { jurisdiction_key: "hartford|ct", gap_days: 10 },
      { jurisdiction_key: "hartford|ct", gap_days: -5 }, // invalid
      { jurisdiction_key: "hartford|ct", gap_days: 100 },
    ];
    const map = buildJurisdictionP95(rows);
    expect(map.get("hartford|ct")).toBe(100);
  });
  it("returns empty map on empty input", () => {
    expect(buildJurisdictionP95([]).size).toBe(0);
  });
});

describe("classifyAnomaly", () => {
  it("returns not stuck when gap is null", () => {
    expect(classifyAnomaly(null, 50)).toEqual({ anomaly_score: 0, is_stuck: false });
  });
  it("returns not stuck when p95 is null", () => {
    expect(classifyAnomaly(60, null)).toEqual({ anomaly_score: 0, is_stuck: false });
  });
  it("returns not stuck when gap < MIN_GAP_TO_BE_STUCK_DAYS", () => {
    expect(classifyAnomaly(20, 10)).toEqual({ anomaly_score: 0, is_stuck: false });
    expect(classifyAnomaly(MIN_GAP_TO_BE_STUCK_DAYS - 1, 5)).toEqual({
      anomaly_score: 0,
      is_stuck: false,
    });
  });
  it("returns not stuck when p95 is 0 (no historical data)", () => {
    expect(classifyAnomaly(60, 0)).toEqual({ anomaly_score: 0, is_stuck: false });
  });
  it("returns stuck when gap > p95 AND >= 30 days", () => {
    const result = classifyAnomaly(100, 50);
    expect(result.is_stuck).toBe(true);
    expect(result.anomaly_score).toBe(2.0);
  });
  it("returns NOT stuck when gap == p95", () => {
    const result = classifyAnomaly(50, 50);
    expect(result.is_stuck).toBe(false);
    expect(result.anomaly_score).toBe(1.0);
  });
  it("caps anomaly_score at MAX_ANOMALY_SCORE", () => {
    const result = classifyAnomaly(10000, 50); // ratio 200
    expect(result.anomaly_score).toBe(MAX_ANOMALY_SCORE);
    expect(result.is_stuck).toBe(true);
  });
  it("rounds anomaly_score to 2 decimals", () => {
    const result = classifyAnomaly(133, 50); // ratio 2.66
    expect(result.anomaly_score).toBe(2.66);
  });
});

describe("Constants exposed at documented thresholds", () => {
  it("MIN_GAP_TO_BE_STUCK_DAYS is 30", () => {
    expect(MIN_GAP_TO_BE_STUCK_DAYS).toBe(30);
  });
  it("MAX_ANOMALY_SCORE is 10", () => {
    expect(MAX_ANOMALY_SCORE).toBe(10);
  });
});
