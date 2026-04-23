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

  it("total equals sum of sub-scores (capped at 100)", () => {
    const result = calculateScore(makeSignals());
    const sum =
      result.freshness +
      result.value +
      result.contact +
      result.demand +
      result.engagement +
      result.conversion;
    expect(result.total).toBe(Math.min(100, sum));
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
