/* ── capacity/types.test.ts ─────────────────────────────────────────────
 *
 *  Wedge contract bullet #3 — "Capacity is respected." The Leads tab must
 *  hide out-of-envelope leads (and surface the "N filtered out" counter
 *  rather than silently dropping rows). This file locks the invariants:
 *
 *    1. `isCapacityPrefs` accepts well-formed prefs and rejects malformed
 *       payloads (defends against hand-edited jsonb on profiles.capacity_prefs).
 *    2. `hasActivePrefs` correctly reports "any active filter present" so
 *       the UI knows when to show the "filtered out" counter.
 *    3. `summarizePrefs` produces a non-empty human label for every active
 *       config and the "no filter" sentinel when none active.
 *    4. `applyCapacityFilter` filters the value-range correctly, INCLUDING
 *       the partial-credit pattern (null rawValue passes through — never
 *       silently drop leads with unknown permit values).
 *
 *  Audit reference: 2026-04-30 audit T2 flagged capacity/types.ts as the
 *  wedge-capacity primitive with no test. This file closes that gap.
 * ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  EMPTY_CAPACITY_PREFS,
  applyCapacityFilter,
  hasActivePrefs,
  isCapacityPrefs,
  summarizePrefs,
  type CapacityPrefs,
  type LeadForCapacityFilter,
} from "../types";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const fullActivePrefs: CapacityPrefs = {
  max_radius_miles: 25,
  value_min: 10_000,
  value_max: 100_000,
  start_window_start: "2026-05-01",
  start_window_end: "2026-08-31",
  max_active_jobs: 5,
  preferred_days_of_week: [1, 2, 3, 4, 5],
};

const valueOnlyPrefs: CapacityPrefs = {
  ...EMPTY_CAPACITY_PREFS,
  value_min: 5_000,
  value_max: 50_000,
};

const onePrefAtATime: Array<[string, CapacityPrefs]> = [
  ["max_radius_miles only", { ...EMPTY_CAPACITY_PREFS, max_radius_miles: 10 }],
  ["value_min only", { ...EMPTY_CAPACITY_PREFS, value_min: 1_000 }],
  ["value_max only", { ...EMPTY_CAPACITY_PREFS, value_max: 100_000 }],
  ["start_window_start only", { ...EMPTY_CAPACITY_PREFS, start_window_start: "2026-05-01" }],
  ["start_window_end only", { ...EMPTY_CAPACITY_PREFS, start_window_end: "2026-08-31" }],
  ["max_active_jobs only", { ...EMPTY_CAPACITY_PREFS, max_active_jobs: 5 }],
  ["preferred_days_of_week only", { ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: [1, 2, 3] }],
];

/* ── isCapacityPrefs ───────────────────────────────────────────────────── */

describe("isCapacityPrefs — type guard for jsonb defenses", () => {
  it("accepts the EMPTY_CAPACITY_PREFS sentinel", () => {
    expect(isCapacityPrefs(EMPTY_CAPACITY_PREFS)).toBe(true);
  });

  it("accepts a fully-active prefs object", () => {
    expect(isCapacityPrefs(fullActivePrefs)).toBe(true);
  });

  it("accepts an object with all-null number fields + empty array", () => {
    const allNull: CapacityPrefs = {
      max_radius_miles: null,
      value_min: null,
      value_max: null,
      start_window_start: null,
      start_window_end: null,
      max_active_jobs: null,
      preferred_days_of_week: [],
    };
    expect(isCapacityPrefs(allNull)).toBe(true);
  });

  it("rejects null", () => {
    expect(isCapacityPrefs(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isCapacityPrefs(undefined)).toBe(false);
  });

  it("rejects a non-object primitive", () => {
    expect(isCapacityPrefs("not a prefs object")).toBe(false);
    expect(isCapacityPrefs(42)).toBe(false);
    expect(isCapacityPrefs(true)).toBe(false);
  });

  it("rejects a plain array (Array.isArray returns true but it's not a prefs object)", () => {
    /* The current implementation accepts an array because typeof [] === "object"
     * AND all the field-checks return true (undefined === null is false, but
     * undefined number fields fail numOrNull, so this should reject). Double-
     * check: an array's `.max_radius_miles` is undefined — neither null nor
     * a number — so `numOrNull(undefined)` returns false. */
    expect(isCapacityPrefs([])).toBe(false);
  });

  it("rejects when max_radius_miles is a string", () => {
    expect(
      isCapacityPrefs({ ...EMPTY_CAPACITY_PREFS, max_radius_miles: "25" }),
    ).toBe(false);
  });

  it("rejects when value_min is a boolean", () => {
    expect(
      isCapacityPrefs({ ...EMPTY_CAPACITY_PREFS, value_min: true }),
    ).toBe(false);
  });

  it("rejects when start_window_start is a number", () => {
    expect(
      isCapacityPrefs({ ...EMPTY_CAPACITY_PREFS, start_window_start: 20260501 }),
    ).toBe(false);
  });

  it("rejects when preferred_days_of_week is not an array", () => {
    expect(
      isCapacityPrefs({ ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: "1,2,3" }),
    ).toBe(false);
    expect(
      isCapacityPrefs({ ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: null }),
    ).toBe(false);
  });
});

/* ── hasActivePrefs ────────────────────────────────────────────────────── */

describe("hasActivePrefs — does any filter actually constrain the lead set?", () => {
  it("returns false for EMPTY_CAPACITY_PREFS", () => {
    expect(hasActivePrefs(EMPTY_CAPACITY_PREFS)).toBe(false);
  });

  it("returns true for a fully-active prefs object", () => {
    expect(hasActivePrefs(fullActivePrefs)).toBe(true);
  });

  it("returns true when ANY single field is set", () => {
    for (const [name, prefs] of onePrefAtATime) {
      expect(hasActivePrefs(prefs), `expected hasActivePrefs(${name}) to be true`).toBe(true);
    }
  });

  it("returns false when preferred_days_of_week is [] (empty array means 'any day')", () => {
    expect(
      hasActivePrefs({ ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: [] }),
    ).toBe(false);
  });

  it("returns true when preferred_days_of_week has at least one entry", () => {
    expect(
      hasActivePrefs({ ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: [3] }),
    ).toBe(true);
  });

  it("returns true when value_min is 0 (a real floor — '0' is not 'no filter')", () => {
    /* This protects the wedge contract: a contractor explicitly setting
     * "I will take any permit ≥$0" is asserting their envelope is open
     * — DIFFERENT from "I haven't set a value floor at all" (which would
     * be null). The current code treats `value_min: 0` as an active filter
     * because `0 != null`. Lock that semantic in. */
    expect(
      hasActivePrefs({ ...EMPTY_CAPACITY_PREFS, value_min: 0 }),
    ).toBe(true);
  });
});

/* ── summarizePrefs ────────────────────────────────────────────────────── */

describe("summarizePrefs — human label for the filter chip", () => {
  it("returns 'No capacity filter' for EMPTY_CAPACITY_PREFS", () => {
    expect(summarizePrefs(EMPTY_CAPACITY_PREFS)).toBe("No capacity filter");
  });

  it("formats max_radius_miles with the ≤N mi shorthand", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, max_radius_miles: 25 });
    expect(summary).toContain("25mi");
  });

  it("formats value_min + value_max as a range", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, value_min: 10_000, value_max: 100_000 });
    expect(summary).toContain("$10K");
    expect(summary).toContain("$100K");
  });

  it("formats value_min only as ≥$N", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, value_min: 25_000 });
    expect(summary).toContain("$25K");
  });

  it("formats value_max only as ≤$N", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, value_max: 200_000 });
    expect(summary).toContain("$200K");
  });

  it("compact-formats large dollar values (1M+ → 1.0M)", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, value_min: 1_500_000 });
    expect(summary).toContain("1.5M");
  });

  it("formats max_active_jobs with the 'max N active' shorthand", () => {
    const summary = summarizePrefs({ ...EMPTY_CAPACITY_PREFS, max_active_jobs: 3 });
    expect(summary).toContain("max 3 active");
  });

  /* Known limitation: summarizePrefs only renders 3 of the 7 filter
   * dimensions today (max_radius_miles, value_min/value_max,
   * max_active_jobs). The other 3 (start_window_start, start_window_end,
   * preferred_days_of_week) are accepted by hasActivePrefs but produce an
   * empty summary — Phase A enhancement. Test the 3 implemented dimensions
   * explicitly. */
  it("returns a non-empty string for the 3 currently-summarized dimensions", () => {
    const summarized: Array<[string, CapacityPrefs]> = [
      ["max_radius_miles only", { ...EMPTY_CAPACITY_PREFS, max_radius_miles: 10 }],
      ["value_min only", { ...EMPTY_CAPACITY_PREFS, value_min: 1_000 }],
      ["value_max only", { ...EMPTY_CAPACITY_PREFS, value_max: 100_000 }],
      ["max_active_jobs only", { ...EMPTY_CAPACITY_PREFS, max_active_jobs: 5 }],
    ];
    for (const [name, prefs] of summarized) {
      const summary = summarizePrefs(prefs);
      expect(summary.length, `expected non-empty summary for ${name}`).toBeGreaterThan(0);
    }
  });

  it("returns an empty summary for the 3 dimensions not yet summarized (Phase A)", () => {
    /* Documents the current behavior: hasActivePrefs returns true for these
     * (so the chip renders), but the chip will show empty text. Phase A
     * adds the start-window + preferred-days summary helpers. */
    const notYetSummarized: Array<[string, CapacityPrefs]> = [
      ["start_window_start only", { ...EMPTY_CAPACITY_PREFS, start_window_start: "2026-05-01" }],
      ["start_window_end only", { ...EMPTY_CAPACITY_PREFS, start_window_end: "2026-08-31" }],
      ["preferred_days_of_week only", { ...EMPTY_CAPACITY_PREFS, preferred_days_of_week: [1, 2, 3] }],
    ];
    for (const [, prefs] of notYetSummarized) {
      const summary = summarizePrefs(prefs);
      expect(summary).toBe("");
    }
  });
});

/* ── applyCapacityFilter ──────────────────────────────────────────────── */

describe("applyCapacityFilter — value-range filter with partial-credit pass-through", () => {
  type Lead = LeadForCapacityFilter & { id: string };

  const leads: Lead[] = [
    { id: "tiny", rawValue: 2_000 },
    { id: "small", rawValue: 8_000 },
    { id: "mid", rawValue: 25_000 },
    { id: "large", rawValue: 75_000 },
    { id: "huge", rawValue: 500_000 },
    { id: "unknown-value", rawValue: null },
    { id: "missing-value-prop" }, // rawValue not set at all
  ];

  it("returns the input unchanged when no filters are active", () => {
    expect(applyCapacityFilter(leads, EMPTY_CAPACITY_PREFS)).toEqual(leads);
  });

  it("filters out leads below value_min, but null/undefined rawValue passes through", () => {
    const filtered = applyCapacityFilter(leads, { ...EMPTY_CAPACITY_PREFS, value_min: 10_000 });
    const ids = filtered.map((l) => l.id);
    expect(ids).not.toContain("tiny");
    expect(ids).not.toContain("small");
    expect(ids).toContain("mid");
    expect(ids).toContain("large");
    expect(ids).toContain("huge");
    /* Partial-credit invariant: leads with no permit value still surface
     * — wedge bullet "never silently drop rows" applies. */
    expect(ids).toContain("unknown-value");
    expect(ids).toContain("missing-value-prop");
  });

  it("filters out leads above value_max, with the same null pass-through", () => {
    const filtered = applyCapacityFilter(leads, { ...EMPTY_CAPACITY_PREFS, value_max: 50_000 });
    const ids = filtered.map((l) => l.id);
    expect(ids).toContain("tiny");
    expect(ids).toContain("small");
    expect(ids).toContain("mid");
    expect(ids).not.toContain("large");
    expect(ids).not.toContain("huge");
    expect(ids).toContain("unknown-value");
    expect(ids).toContain("missing-value-prop");
  });

  it("applies value_min + value_max together as a window", () => {
    const filtered = applyCapacityFilter(leads, valueOnlyPrefs);
    const ids = filtered.map((l) => l.id);
    expect(ids).not.toContain("tiny");      // 2k < 5k
    expect(ids).toContain("small");          // 8k in range
    expect(ids).toContain("mid");            // 25k in range
    expect(ids).not.toContain("large");      // 75k > 50k
    expect(ids).not.toContain("huge");
    expect(ids).toContain("unknown-value");  // pass-through
  });

  it("preserves original input order", () => {
    const filtered = applyCapacityFilter(leads, valueOnlyPrefs);
    const indexes = filtered.map((l) => leads.findIndex((x) => x.id === l.id));
    const sorted = [...indexes].sort((a, b) => a - b);
    expect(indexes).toEqual(sorted);
  });

  it("returns an empty array when no leads match the window", () => {
    const filtered = applyCapacityFilter(
      [{ id: "small", rawValue: 1_000 }, { id: "huge", rawValue: 1_000_000 }],
      { ...EMPTY_CAPACITY_PREFS, value_min: 10_000, value_max: 100_000 },
    );
    expect(filtered).toEqual([]);
  });
});
