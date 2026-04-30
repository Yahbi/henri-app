/**
 * useLeads — orchestration tests for the row-shape mapping that the hook
 * returns to the UI.
 *
 * Audit-04-29 (priority C): the helpers (filter / sort / dedupe / SELECT
 * resolution) are covered by `useLeads.helpers.test.ts`, but the
 * row → Lead mapping was inline in `useLeads.ts` and untested. The merge
 * logic is subtle enough that a regression would silently corrupt every
 * row the dashboard renders:
 *
 *   - address: 4-way fallback (row.address → permit.address →
 *     row.mailing_address → "Unknown")
 *   - city / state: 2-way (row → permit)
 *   - zip: 2-way + empty-string default
 *   - permit_filed_date: applied_date OR issued_date
 *   - permit_age_days: floored days from filed date, null-safe
 *   - latitude / longitude: 2-way (row denormalized → joined permit)
 *
 * Tests intentionally avoid React Query — the hook proper just owns
 * the queryKey + staleTime + cache invalidation; the meaningful logic
 * is the pure mapping. Mirrors the same approach as
 * `useLeads.helpers.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { mapRowsToLeads } from "../useLeads.helpers";

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Build a row with sensible defaults so individual tests stay terse. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "lead-1",
    contractor_id: "user-1",
    permit_id: "permit-1",
    score: 50,
    urgency: "warm",
    status: "new",
    trade: "roofing",
    ...overrides,
  };
}

const ONE_DAY_MS = 86_400_000;

/* ── Tests ───────────────────────────────────────────────────────────── */

describe("mapRowsToLeads — address fallback chain", () => {
  it("prefers row.address over everything else", () => {
    const out = mapRowsToLeads([
      row({
        address: "1 Main St",
        mailing_address: "PO Box 99",
        permits: { address: "999 Permit Lane" },
      }),
    ]);
    expect(out[0].address).toBe("1 Main St");
  });

  it("falls back to permit.address when row.address is missing", () => {
    const out = mapRowsToLeads([
      row({ address: null, permits: { address: "2 Elm Way" } }),
    ]);
    expect(out[0].address).toBe("2 Elm Way");
  });

  it("falls back to mailing_address when both row + permit address are null", () => {
    const out = mapRowsToLeads([
      row({ address: null, mailing_address: "PO Box 7", permits: null }),
    ]);
    expect(out[0].address).toBe("PO Box 7");
  });

  it("returns 'Unknown' when every address source is null/missing", () => {
    const out = mapRowsToLeads([
      row({ address: null, mailing_address: null, permits: null }),
    ]);
    expect(out[0].address).toBe("Unknown");
  });
});

describe("mapRowsToLeads — city / state / zip merging", () => {
  it("merges row-first, falls back to permit", () => {
    const out = mapRowsToLeads([
      row({
        city: null,
        state: null,
        zip: null,
        permits: { city: "Boston", state: "MA", zip: "02118" },
      }),
    ]);
    expect(out[0].city).toBe("Boston");
    expect(out[0].state).toBe("MA");
    expect(out[0].zip).toBe("02118");
  });

  it("zip defaults to '' (not null) when both sources are missing", () => {
    const out = mapRowsToLeads([
      row({ zip: null, permits: { zip: null } }),
    ]);
    expect(out[0].zip).toBe("");
  });

  it("city + state stay null when both sources missing (zip-special-cased)", () => {
    const out = mapRowsToLeads([
      row({ city: null, state: null, permits: null }),
    ]);
    expect(out[0].city).toBeNull();
    expect(out[0].state).toBeNull();
  });
});

describe("mapRowsToLeads — permit_value + permit_type denorm vs join", () => {
  it("prefers row.permit_type over permits.permit_type", () => {
    const out = mapRowsToLeads([
      row({
        permit_type: "Roofing",
        permits: { permit_type: "Other" },
      }),
    ]);
    expect(out[0].permit_type).toBe("Roofing");
  });

  it("falls back to permits.estimated_value when row.permit_value missing", () => {
    const out = mapRowsToLeads([
      row({ permit_value: null, permits: { estimated_value: 75_000 } }),
    ]);
    expect(out[0].permit_value).toBe(75_000);
  });

  it("returns null when neither side has a permit value", () => {
    const out = mapRowsToLeads([
      row({ permit_value: null, permits: null }),
    ]);
    expect(out[0].permit_value).toBeNull();
  });
});

describe("mapRowsToLeads — permit_filed_date + permit_age_days", () => {
  it("uses applied_date when present", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * ONE_DAY_MS).toISOString();
    const out = mapRowsToLeads([
      row({ permits: { applied_date: tenDaysAgo, issued_date: null } }),
    ]);
    expect(out[0].permit_filed_date).toBe(tenDaysAgo);
    expect(out[0].permit_age_days).toBe(10);
  });

  it("falls back to issued_date when applied_date is null", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * ONE_DAY_MS).toISOString();
    const out = mapRowsToLeads([
      row({ permits: { applied_date: null, issued_date: fiveDaysAgo } }),
    ]);
    expect(out[0].permit_filed_date).toBe(fiveDaysAgo);
    expect(out[0].permit_age_days).toBe(5);
  });

  it("returns null for both fields when permit row is null", () => {
    const out = mapRowsToLeads([row({ permits: null })]);
    expect(out[0].permit_filed_date).toBeNull();
    expect(out[0].permit_age_days).toBeNull();
  });

  it("returns null for both fields when permit row has no dates", () => {
    const out = mapRowsToLeads([
      row({ permits: { applied_date: null, issued_date: null } }),
    ]);
    expect(out[0].permit_filed_date).toBeNull();
    expect(out[0].permit_age_days).toBeNull();
  });

  it("permit_age_days is floored, never fractional", () => {
    // 36 hours ago — should floor to 1 day, not 1.5
    const oneAndAHalfDays = new Date(
      Date.now() - 1.5 * ONE_DAY_MS,
    ).toISOString();
    const out = mapRowsToLeads([
      row({ permits: { applied_date: oneAndAHalfDays } }),
    ]);
    expect(out[0].permit_age_days).toBe(1);
  });
});

describe("mapRowsToLeads — latitude / longitude denorm vs join", () => {
  it("prefers row lat/lng over permit lat/lng", () => {
    const out = mapRowsToLeads([
      row({
        latitude: 42.36,
        longitude: -71.05,
        permits: { latitude: 0, longitude: 0 },
      }),
    ]);
    expect(out[0].latitude).toBe(42.36);
    expect(out[0].longitude).toBe(-71.05);
  });

  it("falls back to permit lat/lng when row coords missing", () => {
    const out = mapRowsToLeads([
      row({
        latitude: null,
        longitude: null,
        permits: { latitude: 34.05, longitude: -118.24 },
      }),
    ]);
    expect(out[0].latitude).toBe(34.05);
    expect(out[0].longitude).toBe(-118.24);
  });

  it("returns null lat/lng when both sources are null", () => {
    const out = mapRowsToLeads([
      row({ latitude: null, longitude: null, permits: null }),
    ]);
    expect(out[0].latitude).toBeNull();
    expect(out[0].longitude).toBeNull();
  });
});

describe("mapRowsToLeads — dedupe + identity", () => {
  it("dedupes overlapping rows by id (mirrors paginated god-mode pulls)", () => {
    const out = mapRowsToLeads([
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "a" }), // dupe — earliest wins
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array on empty input", () => {
    expect(mapRowsToLeads([])).toEqual([]);
  });

  it("preserves arbitrary row keys via {...row} spread", () => {
    const out = mapRowsToLeads([
      row({
        id: "lead-7",
        score_signals: [{ signal: "permit_freshness", value: 16 }],
        cascade_count: 3,
        custom_field: "passthrough-value",
      }),
    ]);
    expect(out[0].id).toBe("lead-7");
    // Cast through unknown first because Lead has no string index signature.
    const asRecord = out[0] as unknown as Record<string, unknown>;
    expect(asRecord.cascade_count).toBe(3);
    expect(asRecord.custom_field).toBe("passthrough-value");
  });

  it("permit_description reads from joined permit's description field", () => {
    const out = mapRowsToLeads([
      row({ permits: { description: "Re-roof, asphalt shingles" } }),
    ]);
    const asRecord = out[0] as unknown as Record<string, unknown>;
    expect(asRecord.permit_description).toBe("Re-roof, asphalt shingles");
  });
});

describe("mapRowsToLeads — null-safety contracts", () => {
  it("never throws on a row with no permits join", () => {
    expect(() => mapRowsToLeads([row({ permits: null })])).not.toThrow();
  });

  it("never throws on a row with permits as undefined", () => {
    expect(() => mapRowsToLeads([row({ permits: undefined })])).not.toThrow();
  });

  it("handles an array of all-null-permit rows without crashing", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ id: `lead-${i}`, permits: null, address: null, mailing_address: null }),
    );
    const out = mapRowsToLeads(rows);
    expect(out).toHaveLength(50);
    expect(out.every((l) => l.address === "Unknown")).toBe(true);
    expect(out.every((l) => l.permit_age_days === null)).toBe(true);
  });
});
