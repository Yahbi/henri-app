import { describe, it, expect } from "vitest";
import { tierAllows, periodKey, SOURCE_SPECS } from "../quota";

describe("tierAllows", () => {
  it("free sources always run, every tier", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(tierAllows(tier, "free")).toBe(true);
    }
  });

  it("paid (tier 1) gets the full stack", () => {
    expect(tierAllows(1, "highVolumeFree")).toBe(true);
    expect(tierAllows(1, "keyed")).toBe(true);
    expect(tierAllows(1, "lowQuotaKeyed")).toBe(true);
  });

  it("trial (tier 2) gets free only — no keyed spend", () => {
    expect(tierAllows(2, "highVolumeFree")).toBe(false);
    expect(tierAllows(2, "keyed")).toBe(false);
    expect(tierAllows(2, "lowQuotaKeyed")).toBe(false);
  });

  it("target metro (tier 3) gets free + high-volume-free, no keyed", () => {
    expect(tierAllows(3, "highVolumeFree")).toBe(true);
    expect(tierAllows(3, "keyed")).toBe(false);
    expect(tierAllows(3, "lowQuotaKeyed")).toBe(false);
  });

  it("rest (tier 4) gets free only", () => {
    expect(tierAllows(4, "highVolumeFree")).toBe(false);
    expect(tierAllows(4, "keyed")).toBe(false);
    expect(tierAllows(4, "lowQuotaKeyed")).toBe(false);
  });

  it("low-quota keyed (Numverify/Hunter/Apollo) only on paid tier 1", () => {
    const lowQuota = Object.entries(SOURCE_SPECS)
      .filter(([, s]) => s.class === "lowQuotaKeyed")
      .map(([k]) => k);
    expect(lowQuota).toContain("numverify");
    expect(lowQuota).toContain("hunter_io");
    for (const tier of [2, 3, 4] as const) {
      expect(tierAllows(tier, "lowQuotaKeyed")).toBe(false);
    }
    expect(tierAllows(1, "lowQuotaKeyed")).toBe(true);
  });
});

describe("periodKey", () => {
  const d = new Date(Date.UTC(2026, 5, 9)); // 2026-06-09
  it("formats monthly window as YYYY-MM", () => {
    expect(periodKey("month", d)).toBe("2026-06");
  });
  it("formats daily window as YYYY-MM-DD", () => {
    expect(periodKey("day", d)).toBe("2026-06-09");
  });
  it("monthly for null window", () => {
    expect(periodKey(null, d)).toBe("2026-06");
  });
});

describe("SOURCE_SPECS registry", () => {
  it("keys match orchestrator telemetry names for budgeted keyed sources", () => {
    // These exact strings are passed to allow() in orchestrator.ts and
    // emitted by trace(); a mismatch silently disables gating/accounting.
    for (const k of [
      "opencorporates", "google_places", "yelp", "regrid",
      "numverify", "cloudmersive_phone", "cloudmersive_address",
      "weatherstack", "apollo", "hunter_io",
    ]) {
      expect(SOURCE_SPECS[k]).toBeDefined();
      expect(SOURCE_SPECS[k].budget).toBeGreaterThan(0);
    }
  });
});
