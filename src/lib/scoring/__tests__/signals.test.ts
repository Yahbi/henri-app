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
  it("contains exactly 6 base + 5 optional Wave 1.5/2.A/2.B boosters = 11", () => {
    expect(SCORE_SIGNAL_ORDER).toHaveLength(11);
  });

  it("base 6 weights sum to 100 (boosters are additive on top)", () => {
    const baseTotal = SCORE_SIGNAL_ORDER
      .filter((s) => !s.optional)
      .reduce((acc, s) => acc + s.weight, 0);
    expect(baseTotal).toBe(100);
  });

  it("declares the 11 canonical signal keys (base 6 + 5 boosters)", () => {
    const keys = SCORE_SIGNAL_ORDER.map((s) => s.key);
    const expected: ScoreSignalKey[] = [
      "permit_freshness",
      "permit_value",
      "contact_completeness",
      "zip_demand",
      "homeowner_engagement",
      "historical_conversion",
      "storm_proximity_24h",
      "recent_lien_90d",
      "nri_risk_tier",
      "nfip_flood_history",
      "recent_quake_50mi",
    ];
    expect(keys).toEqual(expected);
  });

  it("uses the documented per-signal weights (20/20/15/15/15/15 + 5/3/3/2/2)", () => {
    const weightByKey = Object.fromEntries(
      SCORE_SIGNAL_ORDER.map((s) => [s.key, s.weight]),
    );
    expect(weightByKey.permit_freshness).toBe(20);
    expect(weightByKey.permit_value).toBe(20);
    expect(weightByKey.contact_completeness).toBe(15);
    expect(weightByKey.zip_demand).toBe(15);
    expect(weightByKey.homeowner_engagement).toBe(15);
    expect(weightByKey.historical_conversion).toBe(15);
    expect(weightByKey.storm_proximity_24h).toBe(5);
    expect(weightByKey.recent_lien_90d).toBe(3);
    expect(weightByKey.nri_risk_tier).toBe(3);
    expect(weightByKey.nfip_flood_history).toBe(2);
    expect(weightByKey.recent_quake_50mi).toBe(2);
  });

  it("flags all 5 boosters as optional (only render when active)", () => {
    const optionalKeys = [
      "storm_proximity_24h",
      "recent_lien_90d",
      "nri_risk_tier",
      "nfip_flood_history",
      "recent_quake_50mi",
    ];
    for (const key of optionalKeys) {
      const row = SCORE_SIGNAL_ORDER.find((s) => s.key === key);
      expect(row?.optional).toBe(true);
    }
    // None of the base 6 are optional.
    for (const s of SCORE_SIGNAL_ORDER.filter((s) => !s.optional)) {
      expect(s.optional).not.toBe(true);
    }
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

  it("returns the 6 base rows (boosters are 0 → omitted) in canonical order", () => {
    expect(breakdown).toHaveLength(6);
    expect(breakdown.map((r) => r.signal)).toEqual(
      SCORE_SIGNAL_ORDER.filter((s) => !s.optional).map((s) => s.key),
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

  it("still returns the 6 base rows even when no factors fired", () => {
    // Boosters at 0 are omitted via the `optional` flag, so we keep the
    // historical "always render base 6" invariant.
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

/* ── Permit value vs property value (audit 2026-08-04) ────────────────
 *
 * `scoreValue` pushes two differently-sourced factors into the same
 * untagged array: "High-value permit ($120K)" (the permit's own declared
 * value) and "High-value property ($600K)" (the assessed-value bonus).
 * `detailFor("permit_value")` matched on /high value|\$\d|value/i, which
 * caught BOTH — so a lead with no permit value but a $600K assessment
 * rendered "Permit value 5/20 — High-value property ($600K)" and a
 * contractor reasonably read that as a $600K permit. The breakdown is the
 * one surface the wedge promises will always be honest. */
describe("buildScoreSignalBreakdown — permit value never shows the property's value", () => {
  const noPermitValueButRichProperty: ScoringSignals = {
    ...emptySignals,
    permitValue: null,
    propertyValue: 600_000,
  };

  const resultWithPropertyBonus: ScoreResult = {
    ...emptyResult,
    value: 5, // 2 baseline + 3 property bonus — none of it from the permit
    factors: ["High-value property ($600K)"],
  };

  it("does not attribute the property assessment to the permit", () => {
    const breakdown = buildScoreSignalBreakdown(
      resultWithPropertyBonus,
      noPermitValueButRichProperty,
    );
    const row = breakdown.find((r) => r.signal === "permit_value");
    expect(row?.detail).not.toMatch(/high-value property/i);
    expect(row?.detail).toMatch(/no permit value/i);
  });

  it("names the property bonus explicitly instead of hiding it", () => {
    const breakdown = buildScoreSignalBreakdown(
      resultWithPropertyBonus,
      noPermitValueButRichProperty,
    );
    const row = breakdown.find((r) => r.signal === "permit_value");
    expect(row?.detail).toMatch(/property assessed at/i);
    expect(row?.detail).toMatch(/600,000/);
  });

  it("still surfaces a real permit-value factor when one exists", () => {
    const withBoth: ScoringSignals = {
      ...populatedSignals,
      permitValue: 120_000,
      propertyValue: 600_000,
    };
    const result: ScoreResult = {
      ...populatedResult,
      value: 20,
      // Order matters: the property factor is pushed AFTER the permit one
      // by scoreValue, but a naive first-match would still have to pick
      // the permit factor.
      factors: ["High-value permit ($120K)", "High-value property ($600K)"],
    };
    const row = buildScoreSignalBreakdown(result, withBoth)
      .find((r) => r.signal === "permit_value");
    expect(row?.detail).toBe("High-value permit ($120K)");
  });

  it("picks the permit factor even when the property factor is listed first", () => {
    const withBoth: ScoringSignals = {
      ...populatedSignals,
      permitValue: 120_000,
      propertyValue: 600_000,
    };
    const result: ScoreResult = {
      ...populatedResult,
      value: 20,
      factors: ["High-value property ($600K)", "Substantial permit ($120K)"],
    };
    const row = buildScoreSignalBreakdown(result, withBoth)
      .find((r) => r.signal === "permit_value");
    expect(row?.detail).toBe("Substantial permit ($120K)");
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

describe("buildScoreSignalBreakdown — Wave 1.5 booster path", () => {
  it("renders the storm booster row when the lead scored >0 on it", () => {
    const result: ScoreResult = { ...populatedResult, storm: 4 };
    const signals: ScoringSignals = { ...populatedSignals, stormProximity24h: 78 };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    expect(breakdown.find((r) => r.signal === "storm_proximity_24h")).toBeDefined();
    expect(breakdown.find((r) => r.signal === "storm_proximity_24h")?.value).toBe(4);
  });

  it("renders the lien booster row when the lead scored >0 on it", () => {
    const result: ScoreResult = { ...populatedResult, lien: 2 };
    const signals: ScoringSignals = { ...populatedSignals, recentLienCount: 3 };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    expect(breakdown.find((r) => r.signal === "recent_lien_90d")).toBeDefined();
    expect(breakdown.find((r) => r.signal === "recent_lien_90d")?.value).toBe(2);
  });

  it("hides booster rows when the lead scored 0 (no nearby storm/lien)", () => {
    const breakdown = buildScoreSignalBreakdown(populatedResult, populatedSignals);
    expect(breakdown.find((r) => r.signal === "storm_proximity_24h")).toBeUndefined();
    expect(breakdown.find((r) => r.signal === "recent_lien_90d")).toBeUndefined();
  });

  it("renders 8 rows when only Wave 1.5 boosters are active", () => {
    const result: ScoreResult = { ...populatedResult, storm: 5, lien: 3 };
    const signals: ScoringSignals = {
      ...populatedSignals,
      stormProximity24h: 92,
      recentLienCount: 7,
    };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    expect(breakdown).toHaveLength(8);
  });

  it("renders all 11 rows when every booster is active", () => {
    const result: ScoreResult = {
      ...populatedResult,
      storm: 5, lien: 3, nri: 3, nfip: 2, quake: 2,
    };
    const signals: ScoringSignals = {
      ...populatedSignals,
      stormProximity24h: 92,
      recentLienCount: 7,
      nriRiskScore: 92,
      nfipClaimCount: 25,
      recentQuakeCount: 3,
    };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    expect(breakdown).toHaveLength(11);
  });

  it("renders nri_risk_tier with intensity-aware detail", () => {
    const result: ScoreResult = { ...populatedResult, nri: 3 };
    const signals: ScoringSignals = { ...populatedSignals, nriRiskScore: 92 };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    const row = breakdown.find((r) => r.signal === "nri_risk_tier");
    expect(row?.value).toBe(3);
    expect(row?.detail).toMatch(/very high area disaster risk/i);
  });

  it("renders nfip_flood_history with claim count", () => {
    const result: ScoreResult = { ...populatedResult, nfip: 2 };
    const signals: ScoringSignals = { ...populatedSignals, nfipClaimCount: 35 };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    const row = breakdown.find((r) => r.signal === "nfip_flood_history");
    expect(row?.value).toBe(2);
    expect(row?.detail).toMatch(/35 NFIP flood claims/i);
  });

  it("renders recent_quake_50mi with quake count", () => {
    const result: ScoreResult = { ...populatedResult, quake: 2 };
    const signals: ScoringSignals = { ...populatedSignals, recentQuakeCount: 4 };
    const breakdown = buildScoreSignalBreakdown(result, signals);
    const row = breakdown.find((r) => r.signal === "recent_quake_50mi");
    expect(row?.value).toBe(2);
    expect(row?.detail).toMatch(/4 M3\.5\+ earthquakes/i);
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

/* Audit finding D (2026-08-05) — the drawer's `permit_value` detail line is
 * the sentence a paying contractor actually reads. When `estimated_value`
 * is null the scorer substitutes the value-forecast model's estimate, and
 * this row used to render it as "Permit value $250,000" — a number the city
 * never published, stated as fact. Truthfulness rule: a modeled figure must
 * be visibly distinguishable from a filed one. */
describe("permit_value detail — modeled vs filed provenance", () => {
  const filed: ScoringSignals = { ...populatedSignals, permitValue: 250_000 };
  const modeled: ScoringSignals = {
    ...populatedSignals,
    permitValue: 250_000,
    permitValueIsModeled: true,
  };
  /* No permit-value factor string, so `detailFor` falls through to the
   * signal-derived sentence — which is exactly the path that fabricated the
   * figure. */
  const resultWithoutValueFactor: ScoreResult = {
    ...populatedResult,
    factors: ["Filed 2 days ago", "Phone number available"],
  };

  const detailOf = (signals: ScoringSignals, result: ScoreResult) =>
    buildScoreSignalBreakdown(result, signals)
      .find((r) => r.signal === "permit_value")!.detail;

  it("states a filed value plainly", () => {
    expect(detailOf(filed, resultWithoutValueFactor)).toBe("Permit value $250,000");
  });

  it("marks a modeled value as modeled, and never as a filed permit value", () => {
    const detail = detailOf(modeled, resultWithoutValueFactor);
    expect(detail).not.toBe("Permit value $250,000");
    expect(detail).toMatch(/modeled/i);
    expect(detail).toMatch(/no value filed/i);
    expect(detail).toContain("~$250,000");
  });

  it("wins over a stale filed-value factor string", () => {
    // `detailFor` prefers a matching factor string. A modeled lead must not
    // be able to reach that branch, or the provenance is lost again.
    const detail = detailOf(modeled, populatedResult); // has "Substantial permit ($75K)"
    expect(detail).toMatch(/modeled/i);
  });
});
