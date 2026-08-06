import { describe, expect, it } from "vitest";
import { SENT_STATUSES, computeRatePct } from "../stats";

/**
 * Regression cover for the 2026-08-06 truthfulness fix.
 *
 * The bug these tests exist to prevent: `Math.round((n / d) * 100) / 100`
 * rounds a fraction to two decimals rather than converting it to a percent,
 * so 5 opens out of 10 sends rendered as "0.5%" in the Outreach card.
 */
describe("computeRatePct", () => {
  it("returns a percentage, not a fraction (the 100x bug)", () => {
    // The exact case that displayed as "0.5%" before the fix.
    expect(computeRatePct(5, 10)).toBe(50);
    expect(computeRatePct(10, 10)).toBe(100);
    expect(computeRatePct(1, 100)).toBe(1);
  });

  it("matches what the card renders with toFixed(1)", () => {
    expect(computeRatePct(5, 10).toFixed(1)).toBe("50.0");
    expect(computeRatePct(1, 3).toFixed(1)).toBe("33.3");
    expect(computeRatePct(2, 3).toFixed(1)).toBe("66.6");
  });

  it("rounds DOWN, never up (CLAUDE.md truthfulness rule)", () => {
    // 2/3 = 66.66…% — must not present as 66.7%.
    expect(computeRatePct(2, 3)).toBe(66.6);
    // 999/1000 = 99.9% exactly; must not creep to 100.
    expect(computeRatePct(999, 1000)).toBe(99.9);
    // 1/1000 = 0.1%
    expect(computeRatePct(1, 1000)).toBe(0.1);
    // 1/10000 = 0.01% — floors to 0.0 rather than inflating to 0.1.
    expect(computeRatePct(1, 10_000)).toBe(0);
  });

  it("keeps one decimal of resolution", () => {
    expect(computeRatePct(125, 1000)).toBe(12.5);
    expect(computeRatePct(3, 8)).toBe(37.5);
  });

  it("returns 0 when nothing has been sent", () => {
    expect(computeRatePct(0, 0)).toBe(0);
    expect(computeRatePct(5, 0)).toBe(0);
    expect(computeRatePct(0, 50)).toBe(0);
  });

  it("never reports a rate above 100%", () => {
    // opened_at can only be stamped on a sent row; a >100% reading would be
    // a webhook racing the status write, not a real result.
    expect(computeRatePct(12, 10)).toBe(100);
  });

  it("is defensive about non-finite input", () => {
    expect(computeRatePct(Number.NaN, 10)).toBe(0);
    expect(computeRatePct(5, Number.NaN)).toBe(0);
    expect(computeRatePct(5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(computeRatePct(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it("rejects negative input rather than rendering a negative rate", () => {
    expect(computeRatePct(-1, 10)).toBe(0);
    expect(computeRatePct(5, -10)).toBe(0);
  });
});

describe("SENT_STATUSES", () => {
  it("counts only statuses where the message actually left Henri", () => {
    expect([...SENT_STATUSES]).toEqual(["sent", "delivered", "opened", "replied"]);
  });

  it("excludes queued and failed from the denominator", () => {
    // A queued row has not been sent; a failed row never reached anyone.
    // Including either would depress every rate on the card.
    const statuses: string[] = [...SENT_STATUSES];
    expect(statuses).not.toContain("queued");
    expect(statuses).not.toContain("failed");
  });
});
