import { describe, it, expect } from "vitest";
import {
  buildSignals,
  calculateScore,
  SCORE_COMPONENT_MAX,
  type ScoringSignals,
} from "../model";

/** Helper to create a default signal set that can be selectively overridden */
function makeSignals(overrides: Partial<ScoringSignals> = {}): ScoringSignals {
  return {
    permitAge: 1,
    daysSinceCreated: 1,
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

describe("calculateScore", () => {
  it("returns a score between 0 and 100", () => {
    const result = calculateScore(makeSignals());
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("returns all expected sub-score fields", () => {
    const result = calculateScore(makeSignals());
    expect(result).toHaveProperty("freshness");
    expect(result).toHaveProperty("value");
    expect(result).toHaveProperty("contact");
    expect(result).toHaveProperty("demand");
    expect(result).toHaveProperty("engagement");
    expect(result).toHaveProperty("conversion");
    expect(result).toHaveProperty("urgency");
    expect(result).toHaveProperty("factors");
  });

  it("total equals sum of sub-scores + all 5 boosters (capped at 100)", () => {
    const result = calculateScore(makeSignals());
    const sum =
      result.freshness +
      result.value +
      result.contact +
      result.demand +
      result.engagement +
      result.conversion +
      (result.storm ?? 0) +
      (result.lien ?? 0) +
      (result.nri ?? 0) +
      (result.nfip ?? 0) +
      (result.quake ?? 0);
    expect(result.total).toBe(Math.min(100, sum));
  });
});

describe("Wave 1.5 storm/lien boosters", () => {
  it("returns 0 storm boost when stormProximity24h is null", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: null }));
    expect(result.storm).toBe(0);
  });

  it("returns +1 storm boost for marginal proximity (<25)", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: 10 }));
    expect(result.storm).toBe(1);
  });

  it("returns +2 storm boost for 25-50 proximity intensity", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: 35 }));
    expect(result.storm).toBe(2);
  });

  it("returns +3 storm boost for 50-75 proximity intensity (severe wind)", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: 60 }));
    expect(result.storm).toBe(3);
  });

  it("returns +4 storm boost for 75-90 (significant hail / strong wind)", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: 80 }));
    expect(result.storm).toBe(4);
  });

  it("returns +5 storm boost (max) for tornado-level intensity", () => {
    const result = calculateScore(makeSignals({ stormProximity24h: 95 }));
    expect(result.storm).toBe(5);
  });

  it("returns 0 lien boost when recentLienCount is null", () => {
    const result = calculateScore(makeSignals({ recentLienCount: null }));
    expect(result.lien).toBe(0);
  });

  it("returns +1 lien boost for a single nearby lien", () => {
    const result = calculateScore(makeSignals({ recentLienCount: 1 }));
    expect(result.lien).toBe(1);
  });

  it("returns +2 lien boost for 2-4 nearby liens", () => {
    const result = calculateScore(makeSignals({ recentLienCount: 3 }));
    expect(result.lien).toBe(2);
  });

  it("returns +3 lien boost (max) for 5+ nearby liens (cluster)", () => {
    const result = calculateScore(makeSignals({ recentLienCount: 8 }));
    expect(result.lien).toBe(3);
  });

  it("boosters fold into the total score", () => {
    // Permit with storm + lien hitting the warm tier should get bumped
    // toward hot when boosters are active.
    const cold = calculateScore(makeSignals({ permitAge: 5 }));
    const boosted = calculateScore(
      makeSignals({
        permitAge: 5,
        stormProximity24h: 92, // +5
        recentLienCount: 7, // +3
      }),
    );
    expect(boosted.total).toBe(Math.min(100, cold.total + 5 + 3));
  });

  it("boosters cap the total at 100 even when raw sum exceeds it", () => {
    // Pile every signal high — the sum could push over 100 with
    // boosters, but the result must clamp.
    const result = calculateScore(
      makeSignals({
        permitAge: 0,
        daysSinceCreated: 0,
        permitValue: 250_000,
        propertyValue: 1_500_000,
        hasPhone: true,
        hasEmail: true,
        hasOwnerName: true,
        ownerOccupied: true,
        zipDemandScore: 90,
        competitorCount: 0,
        seasonalFactor: 1.5,
        isHomeownerIntake: true,
        hasDescription: true,
        cascadeCount: 5,
        zipConversionRate: 0.5,
        tradeConversionRate: 0.5,
        stormProximity24h: 95,
        recentLienCount: 10,
        nriRiskScore: 95,
      }),
    );
    expect(result.total).toBe(100);
  });

  it("emits human-readable factor strings for active boosters", () => {
    const result = calculateScore(
      makeSignals({ stormProximity24h: 80, recentLienCount: 6 }),
    );
    const factors = result.factors.join(" ");
    expect(factors).toMatch(/storm signature within 25mi/i);
    expect(factors).toMatch(/payment-distress/i);
  });
});

describe("Wave 2.A FEMA NRI risk-tier booster", () => {
  it("returns 0 when nriRiskScore is null", () => {
    expect(calculateScore(makeSignals({ nriRiskScore: null })).nri).toBe(0);
  });
  it("returns 0 below the 50-point moderate threshold", () => {
    expect(calculateScore(makeSignals({ nriRiskScore: 30 })).nri).toBe(0);
  });
  it("returns +1 for moderate risk (50-75)", () => {
    expect(calculateScore(makeSignals({ nriRiskScore: 60 })).nri).toBe(1);
  });
  it("returns +2 for high risk (75-90)", () => {
    expect(calculateScore(makeSignals({ nriRiskScore: 80 })).nri).toBe(2);
  });
  it("returns +3 (max) for very-high risk (90+)", () => {
    expect(calculateScore(makeSignals({ nriRiskScore: 95 })).nri).toBe(3);
  });
});

describe("Wave 2.B NFIP flood-claim booster", () => {
  it("returns 0 when nfipClaimCount is null or below 5", () => {
    expect(calculateScore(makeSignals({ nfipClaimCount: null })).nfip).toBe(0);
    expect(calculateScore(makeSignals({ nfipClaimCount: 3 })).nfip).toBe(0);
  });
  it("returns +1 for 5-19 nearby claims", () => {
    expect(calculateScore(makeSignals({ nfipClaimCount: 12 })).nfip).toBe(1);
  });
  it("returns +2 (max) for 20+ claims", () => {
    expect(calculateScore(makeSignals({ nfipClaimCount: 50 })).nfip).toBe(2);
  });
});

describe("Wave 1 USGS quake booster", () => {
  it("returns 0 when recentQuakeCount is null or zero", () => {
    expect(calculateScore(makeSignals({ recentQuakeCount: null })).quake).toBe(0);
    expect(calculateScore(makeSignals({ recentQuakeCount: 0 })).quake).toBe(0);
  });
  it("returns +1 for a single quake", () => {
    expect(calculateScore(makeSignals({ recentQuakeCount: 1 })).quake).toBe(1);
  });
  it("returns +2 (max) for 2+ quakes", () => {
    expect(calculateScore(makeSignals({ recentQuakeCount: 4 })).quake).toBe(2);
  });
});

describe("All boosters combine + cap correctly", () => {
  it("everything-on lead caps at 100", () => {
    const r = calculateScore(makeSignals({
      permitAge: 0, daysSinceCreated: 0,
      permitValue: 250_000, propertyValue: 1_500_000,
      hasPhone: true, hasEmail: true, hasOwnerName: true, ownerOccupied: true,
      zipDemandScore: 95, competitorCount: 0, seasonalFactor: 1.5,
      isHomeownerIntake: true, hasDescription: true, cascadeCount: 5,
      zipConversionRate: 0.5, tradeConversionRate: 0.5,
      stormProximity24h: 95, recentLienCount: 10,
      nriRiskScore: 95, nfipClaimCount: 50, recentQuakeCount: 5,
    }));
    expect(r.total).toBe(100);
  });

  it("base-only lead is unaffected by booster fields being absent", () => {
    const noBoosters = calculateScore(makeSignals({ permitAge: 2 }));
    const explicitNullBoosters = calculateScore(makeSignals({
      permitAge: 2,
      stormProximity24h: null,
      recentLienCount: null,
      nriRiskScore: null,
      nfipClaimCount: null,
      recentQuakeCount: null,
    }));
    expect(noBoosters.total).toBe(explicitNullBoosters.total);
  });
});

describe("freshness scoring", () => {
  it("gives maximum freshness (20) for permits filed today", () => {
    const result = calculateScore(makeSignals({ permitAge: 0, daysSinceCreated: 0 }));
    expect(result.freshness).toBe(20);
  });

  it("gives 16 for permits 1-3 days old", () => {
    const result = calculateScore(makeSignals({ permitAge: 2, daysSinceCreated: 2 }));
    expect(result.freshness).toBe(16);
  });

  it("gives 12 for permits 3-7 days old", () => {
    const result = calculateScore(makeSignals({ permitAge: 5, daysSinceCreated: 5 }));
    expect(result.freshness).toBe(12);
  });

  it("gives 0 for stale permits (30+ days)", () => {
    const result = calculateScore(makeSignals({ permitAge: 45, daysSinceCreated: 45 }));
    expect(result.freshness).toBe(0);
    expect(result.factors).toContain("Stale permit (30+ days old)");
  });

  it("uses the fresher of permitAge and daysSinceCreated", () => {
    const result = calculateScore(makeSignals({ permitAge: 0, daysSinceCreated: 50 }));
    // min(0, 50) = 0 → filed today
    expect(result.freshness).toBe(20);
  });
});

describe("value scoring", () => {
  it("gives baseline 2 when no permit value", () => {
    const result = calculateScore(makeSignals({ permitValue: null }));
    expect(result.value).toBe(2);
  });

  it("gives 20 for $100K+ permits", () => {
    const result = calculateScore(makeSignals({ permitValue: 150_000 }));
    expect(result.value).toBe(20);
  });

  it("adds property value bonus for $500K+ homes", () => {
    const withBonus = calculateScore(makeSignals({
      permitValue: 10_000,
      propertyValue: 1_000_000,
    }));
    const withoutBonus = calculateScore(makeSignals({
      permitValue: 10_000,
      propertyValue: 200_000,
    }));
    expect(withBonus.value).toBeGreaterThan(withoutBonus.value);
  });

  it("caps value at 20", () => {
    const result = calculateScore(makeSignals({
      permitValue: 200_000,
      propertyValue: 2_000_000,
    }));
    expect(result.value).toBeLessThanOrEqual(20);
  });

  /* Audit finding D (2026-08-05) — a value-forecast estimate used to be
   * merged into `permitValue` with no provenance, so the factor string a
   * contractor reads in the drawer asserted "High-value permit ($250K)" for
   * a permit with no `estimated_value` on file. Same points, but the words
   * have to say the number is modeled. */
  describe("modeled (forecast) permit values", () => {
    it("words a filed value as a permit value", () => {
      const result = calculateScore(makeSignals({ permitValue: 250_000 }));
      expect(result.factors).toContain("High-value permit ($250K)");
    });

    it("never words a modeled value like a filed one", () => {
      const result = calculateScore(makeSignals({
        permitValue: 250_000,
        permitValueIsModeled: true,
      }));
      expect(result.factors).not.toContain("High-value permit ($250K)");
      expect(
        result.factors.some((f) => /modeled .* no value filed/i.test(f)),
      ).toBe(true);
      // The estimate is marked approximate, never stated as a fact.
      expect(result.factors.some((f) => f.includes("~$250K"))).toBe(true);
    });

    it("marks the $50K-$100K tier as modeled too", () => {
      const result = calculateScore(makeSignals({
        permitValue: 60_000,
        permitValueIsModeled: true,
      }));
      expect(result.factors).not.toContain("Substantial permit ($60K)");
      expect(
        result.factors.some((f) => /modeled .* no value filed/i.test(f)),
      ).toBe(true);
    });

    it("scores a modeled value identically to a filed one", () => {
      // Provenance changes the WORDS, not the maths — otherwise the flag
      // would silently re-tune every score that depends on the forecaster.
      const filed = calculateScore(makeSignals({ permitValue: 250_000 }));
      const modeled = calculateScore(makeSignals({
        permitValue: 250_000,
        permitValueIsModeled: true,
      }));
      expect(modeled.value).toBe(filed.value);
      expect(modeled.total).toBe(filed.total);
    });
  });
});

describe("contact scoring", () => {
  it("gives 0 when no contact info", () => {
    const result = calculateScore(makeSignals());
    expect(result.contact).toBe(0);
  });

  it("gives 5 for phone number", () => {
    const result = calculateScore(makeSignals({ hasPhone: true }));
    expect(result.contact).toBe(5);
  });

  it("sums phone + email + owner name + owner occupied", () => {
    const result = calculateScore(makeSignals({
      hasPhone: true,       // 5
      hasEmail: true,        // 3
      hasOwnerName: true,    // 3
      ownerOccupied: true,   // 4
    }));
    expect(result.contact).toBe(15);
  });

  it("caps contact at 15", () => {
    const result = calculateScore(makeSignals({
      hasPhone: true,
      hasEmail: true,
      hasOwnerName: true,
      ownerOccupied: true,
    }));
    expect(result.contact).toBeLessThanOrEqual(15);
  });
});

describe("engagement scoring", () => {
  it("gives 0 for permit-only leads", () => {
    const result = calculateScore(makeSignals({ isHomeownerIntake: false }));
    expect(result.engagement).toBe(0);
  });

  it("gives 10 for homeowner-initiated leads", () => {
    const result = calculateScore(makeSignals({ isHomeownerIntake: true }));
    expect(result.engagement).toBe(10);
  });

  it("gives 15 for homeowner intake with description", () => {
    const result = calculateScore(makeSignals({
      isHomeownerIntake: true,
      hasDescription: true,
    }));
    expect(result.engagement).toBe(15);
  });
});

describe("urgency tiers", () => {
  it("returns 'hot' for scores >= 75", () => {
    // Stack all signals high to get a hot score
    const result = calculateScore(makeSignals({
      permitAge: 0,
      daysSinceCreated: 0,
      permitValue: 100_000,
      hasPhone: true,
      hasEmail: true,
      hasOwnerName: true,
      ownerOccupied: true,
      isHomeownerIntake: true,
      hasDescription: true,
      zipConversionRate: 0.5,
      tradeConversionRate: 0.5,
    }));
    expect(result.urgency).toBe("hot");
    expect(result.total).toBeGreaterThanOrEqual(75);
  });

  it("returns 'cold' for minimal signals", () => {
    const result = calculateScore(makeSignals({
      permitAge: 60,
      daysSinceCreated: 60,
      zipConversionRate: 0,
      tradeConversionRate: 0,
    }));
    expect(result.urgency).toBe("cold");
    expect(result.total).toBeLessThan(25);
  });
});

/* Audit finding D (2026-08-05) — `buildSignals` is where the forecast is
 * merged into `permitValue`. The provenance flag has to be derived there,
 * because that is the only place that still knows which of the two inputs
 * the resolved number came from. */
describe("buildSignals — permit-value provenance", () => {
  it("does not flag a value that came off the permit", () => {
    const s = buildSignals({
      permit: { estimated_value: 80_000, predicted_value: 250_000 },
    });
    expect(s.permitValue).toBe(80_000);
    expect(s.permitValueIsModeled).toBe(false);
  });

  it("flags the forecast when the permit has no value on file", () => {
    const s = buildSignals({
      permit: { estimated_value: null, predicted_value: 250_000 },
    });
    expect(s.permitValue).toBe(250_000);
    expect(s.permitValueIsModeled).toBe(true);
  });

  it("does not flag when there is no value at all", () => {
    const s = buildSignals({
      permit: { estimated_value: null, predicted_value: null },
    });
    expect(s.permitValue).toBeNull();
    expect(s.permitValueIsModeled).toBe(false);
  });
});

/* ── Attainable weights (2026-08-07) ──────────────────────────────────────
 *
 * The Hot tier (total >= 75) had never been reached: across 161,345 leads
 * scored by the current model the live maximum was 64, and four of the six
 * components had NEVER reached their declared weight. The largest term was
 * `historical_conversion`, which advertised 15 points but computed
 * `zipRate * 7.5 + tradeRate * 7.5` — payable at 15 only with a 100% close
 * rate in both the ZIP and the trade. 97%+ of leads scored exactly 3 and
 * none had ever exceeded 3, so 12 of the 100 "available" points were
 * structurally dead while the drawer rendered them to contractors as a 3/15
 * bar.
 *
 * These tests lock the invariant that broke: a component may not declare a
 * ceiling that no input can reach. Data-bound gaps (Henri has ~1% phone
 * fill today) are fine — that is a fill-rate problem, and `contact` DOES
 * pay 15 when the data is present. An arithmetically unreachable ceiling
 * is not fine: it is a fabricated denominator.
 * ───────────────────────────────────────────────────────────────────────── */

describe("every declared component weight is attainable", () => {
  /** Inputs that push exactly one component to its ceiling. */
  const maxOut: Record<
    keyof typeof SCORE_COMPONENT_MAX,
    Partial<ScoringSignals>
  > = {
    freshness:  { permitAge: 0 },
    value:      { permitValue: 250_000 },
    contact:    { hasPhone: true, hasEmail: true, hasOwnerName: true, ownerOccupied: true },
    demand:     { zipDemandScore: 100, competitorCount: 0, seasonalFactor: 1.5 },
    engagement: { isHomeownerIntake: true, hasDescription: true },
    conversion: { zipConversionRate: 0.4, tradeConversionRate: 0.4 },
    storm:      { stormProximity24h: 95 },
    lien:       { recentLienCount: 5 },
    nri:        { nriRiskScore: 95 },
    nfip:       { nfipClaimCount: 20 },
    quake:      { recentQuakeCount: 2 },
  };

  for (const [key, overrides] of Object.entries(maxOut)) {
    const component = key as keyof typeof SCORE_COMPONENT_MAX;
    it(`${component} reaches its declared weight of ${SCORE_COMPONENT_MAX[component]}`, () => {
      const result = calculateScore(makeSignals(overrides));
      expect(result[component]).toBe(SCORE_COMPONENT_MAX[component]);
    });
  }

  it("no component ever exceeds its declared weight", () => {
    const everything = calculateScore(
      makeSignals(
        Object.values(maxOut).reduce((acc, o) => ({ ...acc, ...o }), {}),
      ),
    );
    for (const [key, max] of Object.entries(SCORE_COMPONENT_MAX)) {
      const component = key as keyof typeof SCORE_COMPONENT_MAX;
      expect(everything[component] ?? 0).toBeLessThanOrEqual(max);
    }
  });
});

describe("historical conversion — reachable ceiling, unchanged payouts", () => {
  const conv = (zip: number | null, trade: number | null) =>
    calculateScore(
      makeSignals({ zipConversionRate: zip, tradeConversionRate: trade }),
    ).conversion;

  it("pays the national-baseline 3 when there is no local history", () => {
    expect(conv(null, null)).toBe(3);
  });

  it("pays 0 when both markets are known never to convert", () => {
    expect(conv(0, 0)).toBe(0);
  });

  /* The weight change must NOT move any live lead. Every rate at or below
   * the 40% full-credit benchmark produces exactly what the old
   * `rate * 7.5` per side produced — verified here rate by rate. */
  it.each([
    [0.0, 0],
    [0.05, 1],
    [0.1, 2],
    [0.18, 3],
    [0.25, 4],
    [0.3, 5],
    [0.4, 6],
  ])("a %s close rate still pays %i, exactly as before", (rate, expected) => {
    expect(conv(rate, rate)).toBe(expected);
  });

  it("saturates at the weight instead of paying for impossible close rates", () => {
    // The old mapping paid 15 here — a ceiling that required winning every
    // single lead in both the ZIP and the trade.
    expect(conv(1, 1)).toBe(SCORE_COMPONENT_MAX.conversion);
    expect(conv(0.9, 0.9)).toBe(SCORE_COMPONENT_MAX.conversion);
  });
});

describe("contact scoring — no unreachable partial-credit floor", () => {
  it("pays the full 5 for an owner name alone (the removed floor paid 3)", () => {
    expect(calculateScore(makeSignals({ hasOwnerName: true })).contact).toBe(5);
  });

  it("pays 0 when there is no contact signal of any kind", () => {
    expect(calculateScore(makeSignals()).contact).toBe(0);
  });
});
