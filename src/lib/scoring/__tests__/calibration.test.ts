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
