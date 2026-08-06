/**
 * Tests for `src/lib/territory/trades.ts`.
 *
 * The list has to stay byte-identical to the `trade_type` enum declared in
 * supabase/migrations/00002_profiles.sql:9-15. Territory exclusivity is
 * keyed on that enum (migration 00135) and `get_zip_availability(p_zip,
 * p_trade)` types its second argument as `public.trade_type` — a label that
 * drifts out of the enum is a Postgres cast error, not a graceful null.
 */
import { describe, it, expect } from "vitest";
import { TRADE_TYPES, TRADE_LABELS, isTradeType, tradeLabel } from "../trades";

describe("TRADE_TYPES", () => {
  it("matches the trade_type enum exactly, in order", () => {
    expect([...TRADE_TYPES]).toEqual([
      "general",
      "roofing",
      "plumbing",
      "electrical",
      "hvac",
      "solar",
      "landscaping",
      "painting",
      "concrete",
      "other",
    ]);
  });

  it("has ten values — the ceiling get_zip_availability reports as slots_total", () => {
    expect(TRADE_TYPES).toHaveLength(10);
  });

  it("labels every value, so no raw slug can reach the UI", () => {
    for (const t of TRADE_TYPES) {
      expect(TRADE_LABELS[t]).toBeTruthy();
    }
  });
});

describe("isTradeType", () => {
  it("accepts every enum value", () => {
    for (const t of TRADE_TYPES) expect(isTradeType(t)).toBe(true);
  });

  it("rejects near-misses and non-strings", () => {
    expect(isTradeType("Roofing")).toBe(false);
    expect(isTradeType("general remodel")).toBe(false);
    expect(isTradeType("")).toBe(false);
    expect(isTradeType(null)).toBe(false);
    expect(isTradeType(undefined)).toBe(false);
    expect(isTradeType(7)).toBe(false);
  });
});

describe("tradeLabel", () => {
  it("renders the friendly label", () => {
    expect(tradeLabel("hvac")).toBe("HVAC");
  });

  it("degrades to a neutral phrase when the trade is unknown", () => {
    expect(tradeLabel(null)).toBe("your trade");
    expect(tradeLabel("")).toBe("your trade");
  });

  it("passes an unrecognised value through rather than dropping it", () => {
    // An unknown label is information; an empty string is not.
    expect(tradeLabel("windows")).toBe("windows");
  });
});
