/* ── cascade.test.ts ────────────────────────────────────────────────────
 *
 *  Tier A+ Sprint 1 — F2 cascade prediction tests.
 *
 *  Locks the invariants:
 *    1. clampProbability bounds to [0, 1] and rounds to 3 decimals.
 *    2. deriveConfidenceLabel returns the correct bucket for sample sizes.
 *    3. normalizeTrade maps free-text trades to canonical 7 (or null).
 *    4. extractCascadePairs returns valid (primary, follow_on, days)
 *       triples sorted by date, capped at 365-day windows.
 *    5. aggregateBuckets collects pairs by (primary :: follow_on) keys.
 *    6. bucketsToPredictions filters out predictions below MIN_SAMPLE_SIZE.
 *    7. MIN_SAMPLE_SIZE threshold (10) is enforced.
 * ──────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  CANONICAL_TRADES,
  MIN_SAMPLE_SIZE,
  aggregateBuckets,
  bucketsToPredictions,
  clampProbability,
  deriveConfidenceLabel,
  extractCascadePairs,
  normalizeTrade,
  type CanonicalTrade,
} from "../cascade";

describe("clampProbability", () => {
  it("clamps negative to 0", () => {
    expect(clampProbability(-0.5)).toBe(0);
  });
  it("clamps > 1 to 1", () => {
    expect(clampProbability(1.5)).toBe(1);
  });
  it("rounds to 3 decimal places", () => {
    expect(clampProbability(0.12345)).toBe(0.123);
    expect(clampProbability(0.9876)).toBe(0.988);
  });
  it("returns 0 for NaN / Infinity", () => {
    expect(clampProbability(Number.NaN)).toBe(0);
    expect(clampProbability(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("preserves valid in-range values", () => {
    expect(clampProbability(0.5)).toBe(0.5);
    expect(clampProbability(0)).toBe(0);
    expect(clampProbability(1)).toBe(1);
  });
});

describe("deriveConfidenceLabel", () => {
  it("returns 'low' for sample_size < 50", () => {
    expect(deriveConfidenceLabel(0)).toBe("low");
    expect(deriveConfidenceLabel(10)).toBe("low");
    expect(deriveConfidenceLabel(49)).toBe("low");
  });
  it("returns 'medium' for 50 <= sample_size < 500", () => {
    expect(deriveConfidenceLabel(50)).toBe("medium");
    expect(deriveConfidenceLabel(250)).toBe("medium");
    expect(deriveConfidenceLabel(499)).toBe("medium");
  });
  it("returns 'high' for sample_size >= 500", () => {
    expect(deriveConfidenceLabel(500)).toBe("high");
    expect(deriveConfidenceLabel(2000)).toBe("high");
    expect(deriveConfidenceLabel(100_000)).toBe("high");
  });
});

describe("normalizeTrade", () => {
  it("returns canonical trade as-is", () => {
    for (const t of CANONICAL_TRADES) {
      expect(normalizeTrade(t)).toBe(t);
    }
  });
  it("maps roof aliases to roofing", () => {
    expect(normalizeTrade("Roof Replacement")).toBe("roofing");
    expect(normalizeTrade("RE-ROOF")).toBe("roofing");
  });
  it("maps hvac aliases", () => {
    expect(normalizeTrade("AC Install")).toBe("hvac");
    expect(normalizeTrade("Furnace Repair")).toBe("hvac");
    expect(normalizeTrade("Air Conditioning")).toBe("hvac");
  });
  it("maps plumbing aliases", () => {
    expect(normalizeTrade("Plumb")).toBe("plumbing");
    expect(normalizeTrade("Water Heater")).toBe("plumbing");
  });
  it("maps electrical aliases", () => {
    expect(normalizeTrade("Electric Panel Upgrade")).toBe("electrical");
    expect(normalizeTrade("New Wiring")).toBe("electrical");
  });
  it("maps solar aliases", () => {
    expect(normalizeTrade("Solar PV Install")).toBe("solar");
  });
  it("maps adu aliases", () => {
    expect(normalizeTrade("ADU Conversion")).toBe("adu");
    expect(normalizeTrade("Accessory Dwelling Unit")).toBe("adu");
  });
  it("maps remodel aliases to general remodel", () => {
    expect(normalizeTrade("Kitchen Remodel")).toBe("general remodel");
    expect(normalizeTrade("Bath Renovation")).toBe("general remodel");
    expect(normalizeTrade("Addition")).toBe("general remodel");
  });
  it("returns null for unrecognized text", () => {
    expect(normalizeTrade("OTHER")).toBe(null);
    expect(normalizeTrade("")).toBe(null);
    expect(normalizeTrade(null)).toBe(null);
    expect(normalizeTrade(undefined)).toBe(null);
    expect(normalizeTrade("Permit Type Foo")).toBe(null);
  });
});

describe("extractCascadePairs", () => {
  it("returns empty for empty input", () => {
    expect(extractCascadePairs([])).toEqual([]);
  });
  it("returns empty for single permit", () => {
    expect(
      extractCascadePairs([{ trade: "roofing", applied_date: "2024-01-15" }]),
    ).toEqual([]);
  });
  it("extracts a 2-permit cascade", () => {
    const pairs = extractCascadePairs([
      { trade: "roofing", applied_date: "2024-01-15" },
      { trade: "hvac", applied_date: "2024-04-15" },
    ]);
    expect(pairs.length).toBe(1);
    expect(pairs[0].primary_trade).toBe("roofing");
    expect(pairs[0].follow_on_trade).toBe("hvac");
    expect(pairs[0].days_between).toBe(91);
  });
  it("sorts by date (later → earlier ignored)", () => {
    const pairs = extractCascadePairs([
      { trade: "hvac", applied_date: "2024-04-15" },
      { trade: "roofing", applied_date: "2024-01-15" },
    ]);
    expect(pairs.length).toBe(1);
    expect(pairs[0].primary_trade).toBe("roofing"); // earlier date wins as primary
  });
  it("skips same-trade pairs (re-pulls, not cascades)", () => {
    const pairs = extractCascadePairs([
      { trade: "roofing", applied_date: "2024-01-15" },
      { trade: "roofing", applied_date: "2024-04-15" }, // same trade — not a cascade
    ]);
    expect(pairs.length).toBe(0);
  });
  it("caps look-ahead at 365 days", () => {
    const pairs = extractCascadePairs([
      { trade: "roofing", applied_date: "2024-01-15" },
      { trade: "hvac", applied_date: "2025-04-15" }, // > 365 days
    ]);
    expect(pairs.length).toBe(0);
  });
  it("falls back to issued_date when applied_date missing", () => {
    const pairs = extractCascadePairs([
      { trade: "roofing", issued_date: "2024-01-15" },
      { trade: "hvac", issued_date: "2024-03-15" },
    ]);
    expect(pairs.length).toBe(1);
  });
  it("normalizes free-text trades", () => {
    const pairs = extractCascadePairs([
      { trade: "Re-Roof", applied_date: "2024-01-15" },
      { trade: "AC Install", applied_date: "2024-03-15" },
    ]);
    expect(pairs.length).toBe(1);
    expect(pairs[0].primary_trade).toBe("roofing");
    expect(pairs[0].follow_on_trade).toBe("hvac");
  });
  it("skips permits with unrecognized trades", () => {
    const pairs = extractCascadePairs([
      { trade: "roofing", applied_date: "2024-01-15" },
      { trade: "Permit Type Foo", applied_date: "2024-02-15" }, // unrecognized
      { trade: "hvac", applied_date: "2024-03-15" },
    ]);
    // Should still get roofing → hvac, skipping the foo permit
    expect(pairs.length).toBe(1);
    expect(pairs[0].primary_trade).toBe("roofing");
    expect(pairs[0].follow_on_trade).toBe("hvac");
  });
});

describe("aggregateBuckets", () => {
  it("groups pairs by (primary :: follow_on) key", () => {
    const buckets = aggregateBuckets([
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 60 },
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 100 },
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 300 },
    ]);
    expect(buckets.size).toBe(1);
    const key = "roofing::hvac";
    const bucket = buckets.get(key)!;
    expect(bucket.total).toBe(3);
    expect(bucket.within_90d).toBe(1); // 60d
    expect(bucket.within_180d).toBe(2); // 60d + 100d
    expect(bucket.within_365d).toBe(3); // all three
  });
  it("returns empty map for empty input", () => {
    expect(aggregateBuckets([]).size).toBe(0);
  });
});

describe("bucketsToPredictions", () => {
  it("filters out predictions with sample_size below MIN_SAMPLE_SIZE", () => {
    const buckets = aggregateBuckets([
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 60 },
    ]);
    const counts = new Map<CanonicalTrade, number>([
      ["roofing", 5], // below MIN_SAMPLE_SIZE=10
    ]);
    expect(bucketsToPredictions(buckets, counts)).toEqual([]);
  });
  it("emits predictions when sample size >= MIN_SAMPLE_SIZE", () => {
    const buckets = aggregateBuckets([
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 60 },
      { primary_trade: "roofing", follow_on_trade: "hvac", days_between: 100 },
    ]);
    const counts = new Map<CanonicalTrade, number>([["roofing", 100]]);
    const predictions = bucketsToPredictions(buckets, counts);
    expect(predictions.length).toBe(1);
    expect(predictions[0].predicted_trade).toBe("hvac");
    expect(predictions[0].sample_size).toBe(100);
    expect(predictions[0].prob_90d).toBe(0.01); // 1 / 100
    expect(predictions[0].prob_180d).toBe(0.02); // 2 / 100
    expect(predictions[0].prob_365d).toBe(0.02); // 2 / 100 (both within 365)
    expect(predictions[0].confidence_label).toBe("medium");
  });
  it("MIN_SAMPLE_SIZE is exposed at the documented threshold (10)", () => {
    expect(MIN_SAMPLE_SIZE).toBe(10);
  });
});
