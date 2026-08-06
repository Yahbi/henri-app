import { describe, it, expect, afterEach } from "vitest";
import {
  tierAllows,
  periodKey,
  sourceKeyConfigured,
  SOURCE_SPECS,
} from "../quota";

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

describe("sourceKeyConfigured", () => {
  const touched: string[] = [];
  const setEnv = (name: string, value: string | undefined) => {
    touched.push(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(() => {
    for (const name of touched) delete process.env[name];
    touched.length = 0;
  });

  it("free / in-DB sources need no key", () => {
    expect(sourceKeyConfigured("county_gis")).toBe(true);
    expect(sourceKeyConfigured("same_address_permit")).toBe(true);
    expect(sourceKeyConfigured("ppp_sba")).toBe(true);
  });

  it("unknown sources are not blocked", () => {
    expect(sourceKeyConfigured("not_a_source")).toBe(true);
  });

  it("a keyed source is unavailable while its env var is unset", () => {
    setEnv("WEATHERSTACK_API_KEY", undefined);
    expect(sourceKeyConfigured("weatherstack")).toBe(false);
  });

  it("whitespace-only is treated as unset", () => {
    setEnv("REGRID_API_KEY", "   ");
    expect(sourceKeyConfigured("regrid")).toBe(false);
  });

  it("becomes available as soon as the key is present", () => {
    setEnv("HUNTER_API_KEY", "hk_test");
    expect(sourceKeyConfigured("hunter_io")).toBe(true);
  });

  it("both Cloudmersive sources share one key", () => {
    setEnv("CLOUDMERSIVE_API_KEY", "cm_test");
    expect(sourceKeyConfigured("cloudmersive_phone")).toBe(true);
    expect(sourceKeyConfigured("cloudmersive_address")).toBe(true);
  });

  it("every budgeted source names the env var that gates its network call", () => {
    // A budgeted source with no `env` would be billed for invocations that
    // cannot reach the wire — the exact defect this map exists to prevent.
    const budgetedWithoutEnv = Object.entries(SOURCE_SPECS)
      .filter(([, spec]) => spec.budget != null && !spec.env)
      .map(([name]) => name);
    expect(budgetedWithoutEnv).toEqual([]);
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
