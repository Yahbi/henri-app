/**
 * Module 13 — score calibration tests.
 *
 * Verifies the (trade weights, stage modifier) plumbing on
 * `calculateScore`. Each test isolates one calibration axis and
 * pins the assertion to a single behaviour: weights shift component
 * emphasis, modifier scales total, cap clamps at the stage ceiling.
 *
 * Verification gate (per plan Z.15 §5):
 *   - permit_filed_no_contractor lead caps at 100   ✓
 *   - pre_intent caps at 60                          ✓
 *   - archived returns 0                             ✓
 *   - per-trade weights move scores measurably for roofing vs general ✓
 */

import { describe, it, expect } from "vitest";
import {
  calculateScore,
  type ScoringSignals,
  type ScoreCalibration,
} from "../model";

/** Strong-hot signals — every base component near max + boosters firing.
 *  Used as a fixture for stage cap verification: raw total before
 *  stage modifier is in the high-90s, so any cap below 100 should
 *  visibly clamp the result. */
function strongSignals(): ScoringSignals {
  return {
    permitAge: 0,                 // Filed today → 20/20 freshness
    daysSinceCreated: 0,
    permitValue: 200_000,         // 20/20 value
    propertyValue: 1_500_000,     // +3 bonus (capped at 20)
    projectType: "roofing",
    hasPhone: true,
    hasEmail: true,
    hasOwnerName: true,
    ownerOccupied: true,          // 5+3+5+4 = 17, capped to 15
    zipDemandScore: 90,           // 9 zip + 5 seasonal (1.0) = 14, ~15
    competitorCount: 0,           // +1 = 15 capped
    seasonalFactor: 1.5,          // peak season → 5 seasonal pts
    isHomeownerIntake: true,      // +10
    hasDescription: true,         // +5 → 15 engagement
    cascadeCount: 4,              // (no effect — homeowner intake already 15)
    zipConversionRate: 0.4,
    tradeConversionRate: 0.4,
    stormProximity24h: 95,        // +5 booster
    recentLienCount: 5,           // +3 booster
    nriRiskScore: 95,             // +3 booster
    nfipClaimCount: 25,           // +2 booster
    recentQuakeCount: 2,          // +2 booster
  };
}

describe("calculateScore — Module 13 calibration", () => {
  it("no calibration → behaves like the legacy scorer (total preserved)", () => {
    const signals = strongSignals();
    const baseline = calculateScore(signals);
    const withEmpty = calculateScore(signals, {});
    expect(withEmpty.total).toBe(baseline.total);
    expect(withEmpty.freshness).toBe(baseline.freshness);
    expect(withEmpty.value).toBe(baseline.value);
    expect(withEmpty.contact).toBe(baseline.contact);
    expect(withEmpty.demand).toBe(baseline.demand);
  });

  it("permit_filed_no_contractor caps at 100 (modifier=1.0, cap=100 → no clamp)", () => {
    const calibration: ScoreCalibration = {
      stageModifier: {
        stage: "permit_filed_no_contractor",
        cap: 100,
        base_modifier: 1.0,
      },
    };
    const result = calculateScore(strongSignals(), calibration);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThanOrEqual(75); // strong signals → hot
    expect(result.urgency).toBe("hot");
  });

  it("pre_intent caps at 60 (clamps even when underlying signals would score >90)", () => {
    const calibration: ScoreCalibration = {
      stageModifier: {
        stage: "pre_intent",
        cap: 60,
        base_modifier: 0.7,
      },
    };
    const result = calculateScore(strongSignals(), calibration);
    expect(result.total).toBeLessThanOrEqual(60);
    expect(result.urgency).not.toBe("hot");
  });

  it("archived returns 0 (cap=0 + modifier=0 zeroes any underlying total)", () => {
    const calibration: ScoreCalibration = {
      stageModifier: {
        stage: "archived",
        cap: 0,
        base_modifier: 0.0,
      },
    };
    const result = calculateScore(strongSignals(), calibration);
    expect(result.total).toBe(0);
    expect(result.urgency).toBe("cold");
  });

  it("per-trade weights move scores measurably between trades", () => {
    // Same fixture, two different trade-weight rows. Roofing weights
    // freshness up (1.20) so a fresh permit should score higher under
    // roofing than under the no-op general weights.
    const signals = strongSignals();

    const roofingResult = calculateScore(signals, {
      tradeWeights: {
        trade: "roofing",
        freshness_weight: 1.20,
        value_weight: 1.00,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });

    const generalResult = calculateScore(signals, {
      tradeWeights: {
        trade: "general",
        freshness_weight: 1.00,
        value_weight: 1.00,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });

    // Both already saturate at 20 (freshness ceiling), so use a
    // weaker fixture to actually see the multiplier shift through.
    const weakerSignals: ScoringSignals = { ...signals, permitAge: 5, daysSinceCreated: 5 };
    const roofingWeak = calculateScore(weakerSignals, {
      tradeWeights: {
        trade: "roofing",
        freshness_weight: 1.20,
        value_weight: 1.00,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });
    const generalWeak = calculateScore(weakerSignals, {
      tradeWeights: {
        trade: "general",
        freshness_weight: 1.00,
        value_weight: 1.00,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });

    // With permitAge=5 the legacy scorer gives freshness=12. roofing
    // weight of 1.20 → 14.4 → rounded to 14, vs general 12. So
    // roofing freshness > general freshness by 2 points.
    expect(roofingWeak.freshness).toBeGreaterThan(generalWeak.freshness);
    expect(roofingWeak.total).toBeGreaterThanOrEqual(generalWeak.total);

    // Sanity for the saturation case: at full strength they tie.
    expect(roofingResult.total).toBeGreaterThanOrEqual(generalResult.total - 2);
  });

  it("solar value-weight (1.20) lifts permit_value contribution measurably", () => {
    // permit_value=20k normally scores 8/20. Solar's 1.20 weight should
    // lift that to round(8 * 1.20) = round(9.6) = 10.
    const baseSignals = makeWeakSignals({ permitValue: 20_000 });
    const noWeight = calculateScore(baseSignals);
    const solarWeight = calculateScore(baseSignals, {
      tradeWeights: {
        trade: "solar",
        freshness_weight: 1.00,
        value_weight: 1.20,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });
    expect(solarWeight.value).toBeGreaterThan(noWeight.value);
  });

  it("base_modifier=0.5 scales the total by approximately half", () => {
    // Use a moderate fixture so the baseline isn't already
    // saturated at 100 — the modifier scales the underlying
    // sum, not the cap, so a saturated baseline would mask
    // the multiplier's effect.
    const moderate = makeWeakSignals({
      permitAge: 3,
      daysSinceCreated: 3,
      permitValue: 30_000,
      hasOwnerName: true,
      hasPhone: true,
      zipDemandScore: 60,
    });
    const calibration: ScoreCalibration = {
      stageModifier: {
        stage: "completed",
        cap: 100, // generous cap so modifier alone drives the change
        base_modifier: 0.5,
      },
    };
    const baseline = calculateScore(moderate);
    const halved = calculateScore(moderate, calibration);
    // Allow ±2 pts for rounding in component re-clamps and stage-cap math.
    expect(halved.total).toBeLessThanOrEqual(Math.round(baseline.total * 0.5) + 2);
    expect(halved.total).toBeGreaterThanOrEqual(Math.round(baseline.total * 0.5) - 2);
  });

  it("trade calibration shift is reported in the factors array", () => {
    const result = calculateScore(strongSignals(), {
      tradeWeights: {
        trade: "roofing",
        freshness_weight: 1.20,
        value_weight: 1.00,
        contact_weight: 1.00,
        demand_weight: 1.00,
      },
    });
    expect(result.factors.some((f) => /Trade calibration applied/.test(f))).toBe(true);
  });

  it("stage modifier with cap < 100 is reported in the factors array", () => {
    const result = calculateScore(strongSignals(), {
      stageModifier: {
        stage: "pre_intent",
        cap: 60,
        base_modifier: 0.7,
      },
    });
    expect(result.factors.some((f) => /Stage modifier applied/.test(f))).toBe(true);
  });
});

/* ── Wedge bullet #2 — the breakdown must add up ──────────────────────
 *
 * Audit 2026-08-04: the stage modifier and the 100-point cap were applied
 * to the SUM while the components were returned unscaled. Those unscaled
 * components are what `buildScoreSignalBreakdown` persists into
 * `leads.score_signals`, and `ScoreSignalBreakdown.tsx` renders their sum
 * ("46 / 100 signals") directly beside the score circle ("44"). 1,107
 * live leads diverged by 2-7 points, and 69.7% of leads sit in stages
 * with a non-neutral modifier awaiting re-score — the `completed` stage
 * (86k leads, modifier 0.50) would have roughly doubled the gap.
 *
 * The invariant: sum(components) === total, always, for every calibration.
 * "Never hide why a lead scored 65 vs 85" is meaningless if the evidence
 * doesn't reconcile with the number being sold. */
describe("calculateScore — component sum reconciles with the stored total", () => {
  /** Mirror of what buildScoreSignalBreakdown persists + what the drawer
   *  sums: every component row, clamped to its weight exactly as
   *  signals.ts does. */
  function renderedSum(r: ReturnType<typeof calculateScore>): number {
    const rows: Array<[number, number]> = [
      [r.freshness, 20],
      [r.value, 20],
      [r.contact, 15],
      [r.demand, 15],
      [r.engagement, 15],
      [r.conversion, 15],
      [r.storm ?? 0, 5],
      [r.lien ?? 0, 3],
      [r.nri ?? 0, 3],
      [r.nfip ?? 0, 2],
      [r.quake ?? 0, 2],
    ];
    return rows.reduce(
      (n, [raw, weight]) => n + Math.round(Math.max(0, Math.min(weight, raw))),
      0,
    );
  }

  it("reconciles when the 100-point cap clamps a booster-heavy lead", () => {
    // strongSignals sums past 100 on the boosters alone (base ~91 + 15
    // booster points), so the cap fires with no stage calibration at all.
    // This case shipped broken even for contractors on neutral stages.
    const result = calculateScore(strongSignals());
    expect(result.total).toBe(100);
    expect(renderedSum(result)).toBe(result.total);
  });

  it("reconciles when a stage base_modifier < 1 discounts the total", () => {
    // active_intent-shaped: modifier only, generous cap. This is the exact
    // shape of the 1,107 diverging production rows (gap 2-7 points).
    const result = calculateScore(
      makeWeakSignals({
        permitAge: 3,
        daysSinceCreated: 3,
        permitValue: 30_000,
        hasOwnerName: true,
        hasPhone: true,
        zipDemandScore: 60,
        nriRiskScore: 88,
      }),
      { stageModifier: { stage: "active_intent", cap: 90, base_modifier: 0.95 } },
    );
    expect(result.total).toBeGreaterThan(0);
    expect(renderedSum(result)).toBe(result.total);
  });

  it("reconciles when the stage cap clamps below the modified total", () => {
    // pre_intent: cap 60 bites before the modifier's own result.
    const result = calculateScore(strongSignals(), {
      stageModifier: { stage: "pre_intent", cap: 60, base_modifier: 0.7 },
    });
    expect(result.total).toBe(60);
    expect(renderedSum(result)).toBe(result.total);
  });

  it("reconciles for the completed stage (modifier 0.50 — the widest gap)", () => {
    const result = calculateScore(strongSignals(), {
      stageModifier: { stage: "completed", cap: 40, base_modifier: 0.5 },
    });
    expect(result.total).toBe(40);
    expect(renderedSum(result)).toBe(result.total);
  });

  it("reconciles at zero (archived stage)", () => {
    const result = calculateScore(strongSignals(), {
      stageModifier: { stage: "archived", cap: 0, base_modifier: 0.0 },
    });
    expect(result.total).toBe(0);
    expect(renderedSum(result)).toBe(0);
  });

  it("reconciles across every seeded stage modifier from migration 00090", () => {
    // Values copied from supabase/migrations/00090_saved_hidden_alerts_
    // calibration.sql — if a future migration adds a stage, add it here.
    const seeded: Array<[string, number, number]> = [
      ["permit_filed_no_contractor", 100, 1.0],
      ["permit_filed_with_contractor", 80, 0.85],
      ["project_moving", 75, 0.8],
      ["pre_intent", 60, 0.7],
      ["completed", 40, 0.5],
      ["archived", 0, 0.0],
    ];
    const fixtures = [
      strongSignals(),
      makeWeakSignals(),
      makeWeakSignals({ permitAge: 1, permitValue: 90_000, hasOwnerName: true }),
    ];
    for (const [stage, cap, base_modifier] of seeded) {
      for (const signals of fixtures) {
        const result = calculateScore(signals, {
          stageModifier: { stage, cap, base_modifier },
        });
        expect(
          renderedSum(result),
          `stage=${stage} total=${result.total}`,
        ).toBe(result.total);
      }
    }
  });

  it("reconciles when trade weights and a stage modifier are combined", () => {
    const result = calculateScore(strongSignals(), {
      tradeWeights: {
        trade: "roofing",
        freshness_weight: 1.2,
        value_weight: 0.9,
        contact_weight: 1.1,
        demand_weight: 1.0,
      },
      stageModifier: { stage: "project_moving", cap: 75, base_modifier: 0.8 },
    });
    expect(renderedSum(result)).toBe(result.total);
  });

  it("leaves components untouched when nothing clamps or discounts them", () => {
    // Guard against over-correcting: an uncapped, unmodified lead must
    // still report its raw component values.
    const weak = makeWeakSignals({ permitAge: 5, permitValue: 30_000 });
    const result = calculateScore(weak);
    expect(result.freshness).toBe(12); // scoreFreshness: 3 <= age < 7
    expect(renderedSum(result)).toBe(result.total);
  });
});

function makeWeakSignals(overrides: Partial<ScoringSignals> = {}): ScoringSignals {
  return {
    permitAge: 10,
    daysSinceCreated: 10,
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
    zipConversionRate: null,
    tradeConversionRate: null,
    ...overrides,
  };
}
