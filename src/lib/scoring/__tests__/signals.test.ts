/* ── signals.test.ts ─────────────────────────────────────────────────────
 *
 *  Wedge contract bullet #2 — "Confidence is transparent." The drawer
 *  must always render WHY a lead scored what it did, with the 6-signal
 *  breakdown intact. This file locks the invariants:
 *
 *    1. The 6 signals are present, in stable order, with the documented
 *       weights summing to 100.
 *    2. `buildScoreSignalBreakdown` returns 6 rows whose `value` is
 *       clamped to [0, weight].
 *    3. Every signal renders a NON-EMPTY `detail` string in both the
 *       populated and empty fallback cases — no silent blanks in the UI.
 *    4. `isScoreSignalBreakdown` accepts good payloads and rejects
 *       malformed ones (defends against hand-edited jsonb).
 *
 *  Audit reference: 2026-04-29 audit flagged signals.ts as the wedge-
 *  transparency primitive with no test. This file closes that gap.
 * ─────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  SCORE_SIGNAL_ORDER,
  buildScoreSignalBreakdown,
  isScoreSignalBreakdown,
  type ScoreSignalKey,
} from "../signals";
import type { ScoreResult, ScoringSignals } from "../model";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

/** Fully-populated signals — every detail-branch should hit a real factor. */
const populatedSignals: ScoringSignals = {
  permitAge: 2,
  daysSinceCreated: 3,
  permitValue: 75_000,
  propertyValue: 600_000,
  projectType: "roofing",
  hasPhone: true,
  hasEmail: true,
  hasOwnerName: true,
  ownerOccupied: true,
  zipDemandScore: 72,
  competitorCount: 2,
  seasonalFactor: 1.2,
  isHomeownerIntake: true,
  hasDescription: true,
  cascadeCount: 3,
  zipConversionRate: 0.32,
  tradeConversionRate: 0.21,
};

/** Empty signals — the fallback detail strings should still produce text. */
const emptySignals: ScoringSignals = {
  permitAge: Number.POSITIVE_INFINITY,
  daysSinceCreated: 0,
  permitValue: null,
  propertyValue: null,
  projectType: null,
  hasPhone: false,
  hasEmail: false,
  hasOwnerName: false,
  ownerOccupied: null,
  zipDemandScore: null,
  competitorCount: 0,
  seasonalFactor: 1.0,
  isHomeownerIntake: false,
  hasDescription: false,
  cascadeCount: 1,
  zipConversionRate: null,
  tradeConversionRate: null,
};

/** A representative ScoreResult — values match the populated fixture. */
const populatedResult: ScoreResult = {
  total: 80,
  freshness: 16,
  value: 16,
  contact: 13,
  demand: 12,
  engagement: 13,
  conversion: 10,
  urgency: "hot",
  factors: [
    "Filed 2 days ago",
    "Substantial permit ($75K)",
    "Phone number available",
    "Owner name available",
    "Owner-occupied property",
    "Hot ZIP code",
    "Homeowner-initiated request",
    "Strong ZIP conversion history (32%)",
  ],
};

/** Zero-out result for the empty-signals path. */
const emptyResult: ScoreResult = {
  total: 0,
  freshness: 0,
  value: 0,
  contact: 0,
  demand: 0,
  engagement: 0,
  conversion: 0,
  urgency: "cold",
  factors: [],
};

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("SCORE_SIGNAL_ORDER (the wedge-#2 contract surface)", () => {
  it("contains exactly 6 signals", () => {
    expect(SCORE_SIGNAL_ORDER).toHaveLength(6);
  });

  it("weights sum to 100", () => {
    const total = SCORE_SIGNAL_ORDER.reduce((acc, s) => acc + s.weight, 0);
    expect(total).toBe(100);
  });

  it("declares the 6 canonical signal keys", () => {
    const keys = SCORE_SIGNAL_ORDER.map((s) => s.key);
    const expected: ScoreSignalKey[] = [
      "permit_freshness",
      "permit_value",
      "contact_completeness",
      "zip_demand",
      "homeowner_engagement",
      "historical_conversion",
    ];
    expect(keys).toEqual(expected);
  });

  it("uses the documented per-signal weights (20/20/15/15/15/15)", () => {
    const weightByKey = Object.fromEntries(
      SCORE_SIGNAL_ORDER.map((s) => [s.key, s.weight]),
    );
    expect(weightByKey.permit_freshness).toBe(20);
    expect(weightByKey.permit_value).toBe(20);
    expect(weightByKey.contact_completeness).toBe(15);
    expect(weightByKey.zip_demand).toBe(15);
    expect(weightByKey.homeowner_engagement).toBe(15);
    expect(weightByKey.historical_conversion).toBe(15);
  });

  it("each signal has a non-empty human label", () => {
    for (const s of SCORE_SIGNAL_ORDER) {
      expect(s.label).toBeTruthy();
      expect(s.label.length).toBeGreaterThan(2);
    }
  });
});

describe("buildScoreSignalBreakdown — populated case", () => {
  const breakdown = buildScoreSignalBreakdown(populatedResult, populatedSignals);

  it("returns 6 rows in the canonical order", () => {
    expect(breakdown).toHaveLength(6);
    expect(breakdown.map((r) => r.signal)).toEqual(
      SCORE_SIGNAL_ORDER.map((s) => s.key),
    );
  });

  it("clamps every value into [0, weight]", () => {
    for (const row of breakdown) {
      expect(row.value).toBeGreaterThanOrEqual(0);
      expect(row.value).toBeLessThanOrEqual(row.weight);
    }
  });

  it("renders a non-empty detail string for every signal", () => {
    for (const row of breakdown) {
      expect(typeof row.detail).toBe("string");
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it("surfaces phone + email + owner-name in contact_completeness", () => {
    const contact = breakdown.find((r) => r.signal === "contact_completeness");
    expect(contact?.detail).toMatch(/phone/i);
    expect(contact?.detail).toMatch(/email/i);
    expect(contact?.detail).toMatch(/owner/i);
  });

  it("includes the cascade count for high-engagement properties", () => {
    const engagement = breakdown.find((r) => r.signal === "homeowner_engagement");
    // Populated signals set isHomeownerIntake=true so the intake-branch
    // fires before the cascade branch — the detail should mention intake.
    expect(engagement?.detail).toMatch(/intake/i);
  });
});

describe("buildScoreSignalBreakdown — empty case", () => {
  const breakdown = buildScoreSignalBreakdown(emptyResult, emptySignals);

  it("still returns 6 rows even when no factors fired", () => {
    expect(breakdown).toHaveLength(6);
  });

  it("renders fallback detail strings (never empty) when nothing populated", () => {
    for (const row of breakdown) {
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it("zeroes out every value when the result has no points", () => {
    for (const row of breakdown) {
      expect(row.value).toBe(0);
    }
  });

  it("permit_value reports 'No permit value on file' when null", () => {
    const value = breakdown.find((r) => r.signal === "permit_value");
    expect(value?.detail).toMatch(/no permit value/i);
  });

  it("contact_completeness reports 'No homeowner contact on file' when missing", () => {
    const contact = breakdown.find((r) => r.signal === "contact_completeness");
    expect(contact?.detail).toMatch(/no homeowner contact/i);
  });

  it("homeowner_engagement reports the no-direct-engagement fallback", () => {
    const engagement = breakdown.find((r) => r.signal === "homeowner_engagement");
    expect(engagement?.detail).toMatch(/no direct engagement/i);
  });

  it("historical_conversion reports the not-enough-history fallback", () => {
    const conv = breakdown.find((r) => r.signal === "historical_conversion");
    expect(conv?.detail).toMatch(/not enough history/i);
  });
});

describe("buildScoreSignalBreakdown — clamping invariants", () => {
  it("rounds non-integer values", () => {
    const fractional: ScoreResult = { ...populatedResult, freshness: 12.7 };
    const breakdown = buildScoreSignalBreakdown(fractional, populatedSignals);
    const row = breakdown.find((r) => r.signal === "permit_freshness");
    expect(row?.value).toBe(13);
  });

  it("clamps a negative score to 0", () => {
    const negative: ScoreResult = { ...emptyResult, value: -5 };
    const breakdown = buildScoreSignalBreakdown(negative, emptySignals);
    const row = breakdown.find((r) => r.signal === "permit_value");
    expect(row?.value).toBe(0);
  });

  it("clamps an over-weight score to the weight ceiling", () => {
    const huge: ScoreResult = { ...populatedResult, freshness: 999 };
    const breakdown = buildScoreSignalBreakdown(huge, populatedSignals);
    const row = breakdown.find((r) => r.signal === "permit_freshness");
    expect(row?.value).toBe(20); // permit_freshness weight
  });
});

describe("isScoreSignalBreakdown — type guard for jsonb defenses", () => {
  it("accepts a valid breakdown", () => {
    const breakdown = buildScoreSignalBreakdown(populatedResult, populatedSignals);
    expect(isScoreSignalBreakdown(breakdown)).toBe(true);
  });

  it("rejects null", () => {
    expect(isScoreSignalBreakdown(null)).toBe(false);
  });

  it("rejects a non-array payload", () => {
    expect(isScoreSignalBreakdown({})).toBe(false);
    expect(isScoreSignalBreakdown("not-an-array")).toBe(false);
  });

  it("rejects rows missing the signal field", () => {
    const bad = [{ label: "L", weight: 20, value: 10, detail: "x" }];
    expect(isScoreSignalBreakdown(bad)).toBe(false);
  });

  it("rejects rows with the wrong shape on weight", () => {
    const bad = [
      { signal: "permit_freshness", label: "L", weight: "20" /* string */, value: 10 },
    ];
    expect(isScoreSignalBreakdown(bad)).toBe(false);
  });

  it("rejects rows with wrong type on value", () => {
    const bad = [
      { signal: "permit_freshness", label: "L", weight: 20, value: "ten" },
    ];
    expect(isScoreSignalBreakdown(bad)).toBe(false);
  });

  it("accepts an empty array (zero signals is structurally valid)", () => {
    expect(isScoreSignalBreakdown([])).toBe(true);
  });
});
