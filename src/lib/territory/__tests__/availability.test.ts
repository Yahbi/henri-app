/**
 * Tests for `src/lib/territory/availability.ts`.
 *
 * This is the regression net for the onboarding territory picker. The same
 * bug has shipped here twice — a hardcoded-true `!data.is_claimed` in the
 * 2026-08-04 pass, then a `slots_used < slots_total` comparison that
 * answered the wrong question once migration 00135 made exclusivity
 * per (zip, trade). Both times the picker showed a green check on a ZIP the
 * claim would refuse, and the contractor found out after checkout.
 *
 * The invariant every case below defends: a green "available" is only ever
 * rendered from evidence. `available_for_trade: null` is unknown, not yes.
 */
import { describe, it, expect } from "vitest";
import {
  readSlots,
  describeSlots,
  otherTradeCount,
  UNKNOWN_SLOTS,
} from "../availability";

describe("readSlots", () => {
  it("prefers the per-trade verdict over the slot comparison", () => {
    // The exact shape that broke: nine of ten trade slots free, but the
    // caller's trade is the taken one.
    const s = readSlots({
      slots_used: 1,
      slots_total: 10,
      taken_trades: ["roofing"],
      available_for_trade: false,
    });

    expect(s.available).toBe(false);
    expect(s.availableForTrade).toBe(false);
  });

  it("treats a full-looking ZIP as available when the caller's trade is free", () => {
    // The mirror failure: nine trades taken does not close the tenth.
    const s = readSlots({
      slots_used: 9,
      slots_total: 10,
      taken_trades: ["roofing", "hvac", "plumbing"],
      available_for_trade: true,
    });

    expect(s.available).toBe(true);
  });

  it("falls back to the slot comparison only when no trade verdict exists", () => {
    expect(readSlots({ slots_used: 1, slots_total: 10 }).available).toBe(true);
    expect(readSlots({ slots_used: 10, slots_total: 10 }).available).toBe(false);
  });

  it("keeps a missing available_for_trade as null rather than coercing it", () => {
    const s = readSlots({ slots_used: 1, slots_total: 10 });
    expect(s.availableForTrade).toBeNull();
  });

  it("ignores a non-boolean available_for_trade", () => {
    const s = readSlots({
      slots_used: 1,
      slots_total: 10,
      available_for_trade: "false",
    });
    expect(s.availableForTrade).toBeNull();
  });

  it("reports an unrecognised payload as unknown, never as available", () => {
    // `is_claimed` is the key the pre-2026-08-04 code read and the RPC has
    // never returned.
    expect(readSlots({ is_claimed: false }).unknown).toBe(true);
    expect(readSlots(null).unknown).toBe(true);
    expect(readSlots({ slots_used: "1", slots_total: 10 }).unknown).toBe(true);
  });

  it("keeps only string trade labels", () => {
    const s = readSlots({
      slots_used: 1,
      slots_total: 10,
      taken_trades: ["roofing", null, 3, "hvac"],
    });
    expect(s.takenTrades).toEqual(["roofing", "hvac"]);
  });
});

describe("describeSlots", () => {
  it("names the trade a ZIP is taken for", () => {
    const s = readSlots({
      slots_used: 1,
      slots_total: 10,
      taken_trades: ["roofing"],
      available_for_trade: false,
    });
    expect(describeSlots(s, "roofing", "Roofing")).toBe("— already taken for Roofing");
  });

  it("counts other trades without naming them", () => {
    const s = readSlots({
      slots_used: 2,
      slots_total: 10,
      taken_trades: ["hvac", "plumbing"],
      available_for_trade: true,
    });
    const text = describeSlots(s, "roofing", "Roofing");

    expect(text).toBe("— open for Roofing (2 other trades claimed here)");
    // Wedge contract: competitive intel stays coarse. A trade name in a ZIP
    // with one occupant identifies the holder to anyone who knows the market.
    expect(text).not.toContain("hvac");
    expect(text).not.toContain("plumbing");
  });

  it("singularises a lone other trade", () => {
    const s = readSlots({
      slots_used: 1,
      slots_total: 10,
      taken_trades: ["hvac"],
      available_for_trade: true,
    });
    expect(describeSlots(s, "roofing", "Roofing")).toBe(
      "— open for Roofing (1 other trade claimed here)",
    );
  });

  it("says nothing extra when the ZIP is untouched", () => {
    const s = readSlots({
      slots_used: 0,
      slots_total: 10,
      taken_trades: [],
      available_for_trade: true,
    });
    expect(describeSlots(s, "roofing", "Roofing")).toBe("— open for Roofing");
  });

  it("phrases the trade-blind fallback as counts, not as an answer", () => {
    const s = readSlots({ slots_used: 3, slots_total: 10 });
    // Must not claim anything about a trade it was never told.
    expect(describeSlots(s, null, "your trade")).toBe("— 3 of 10 trade slots taken");
  });

  it("admits when the probe failed", () => {
    expect(describeSlots(UNKNOWN_SLOTS, "roofing", "Roofing")).toBe(
      "— couldn't check right now",
    );
  });
});

describe("otherTradeCount", () => {
  it("excludes the caller's own trade", () => {
    const s = readSlots({
      slots_used: 3,
      slots_total: 10,
      taken_trades: ["roofing", "hvac", "solar"],
      available_for_trade: false,
    });
    expect(otherTradeCount(s, "roofing")).toBe(2);
  });

  it("counts everything when the caller has no trade", () => {
    const s = readSlots({
      slots_used: 2,
      slots_total: 10,
      taken_trades: ["roofing", "hvac"],
    });
    expect(otherTradeCount(s, null)).toBe(2);
  });
});
