import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringSignals } from "../model";

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

  it("total equals sum of sub-scores + boosters (capped at 100)", () => {
    const result = calculateScore(makeSignals());
    const sum =
      result.freshness +
      result.value +
      result.contact +
      result.demand +
      result.engagement +
      result.conversion +
      (result.storm ?? 0) +
      (result.lien ?? 0);
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
