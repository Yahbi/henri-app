/**
 * Freshness regression tests (2026-06-17 deep-eval fix).
 *
 * scoreFreshness used `Math.min(permitAge, daysSinceCreated)`, which let a
 * fresh INGEST date override an old or missing permit date — decade-old and
 * null-date permits scored "Filed today" (20/20). Freshness now reads the
 * real permit age ALONE. These tests pin that behavior so it can't regress.
 */

import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringSignals } from "../model";

function base(): ScoringSignals {
  return {
    permitAge: 0,
    daysSinceCreated: 0,
    permitValue: 50_000,
    propertyValue: null,
    projectType: "roofing",
    hasPhone: false,
    hasEmail: false,
    hasOwnerName: false,
    ownerOccupied: false,
    zipDemandScore: 50,
    competitorCount: 0,
    seasonalFactor: 1,
    isHomeownerIntake: false,
    hasDescription: false,
    cascadeCount: 1,
    zipConversionRate: null,
    tradeConversionRate: null,
  };
}

describe("scoreFreshness — real permit date only", () => {
  it("a permit filed today scores full freshness (20)", () => {
    expect(calculateScore({ ...base(), permitAge: 0 }).freshness).toBe(20);
  });

  it("REGRESSION: an old permit ingested today scores 0, not 20", () => {
    // permitAge huge (filed years ago) but daysSinceCreated 0 (just ingested).
    // The old Math.min(permitAge, daysSinceCreated) returned 0 -> 20/20. Must be 0.
    const r = calculateScore({ ...base(), permitAge: 2000, daysSinceCreated: 0 });
    expect(r.freshness).toBe(0);
  });

  it("REGRESSION: a permit with no usable date (Infinity) scores 0", () => {
    const r = calculateScore({
      ...base(),
      permitAge: Number.POSITIVE_INFINITY,
      daysSinceCreated: 0,
    });
    expect(r.freshness).toBe(0);
  });

  it("freshness tracks the real permit age, ignoring ingest age", () => {
    // Filed 2 days ago, but sitting in our DB for 100 days -> still "2 days" fresh.
    const r = calculateScore({ ...base(), permitAge: 2, daysSinceCreated: 100 });
    expect(r.freshness).toBe(16);
  });

  it("buckets degrade with real age", () => {
    expect(calculateScore({ ...base(), permitAge: 5 }).freshness).toBe(12);
    expect(calculateScore({ ...base(), permitAge: 20 }).freshness).toBe(4);
    expect(calculateScore({ ...base(), permitAge: 45 }).freshness).toBe(0);
  });
});
