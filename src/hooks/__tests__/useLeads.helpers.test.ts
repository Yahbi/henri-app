/**
 * Tests for `src/hooks/useLeads.helpers.ts` — the supabase-builder helpers
 * extracted from `useLeads.ts`. The audit-priority-#5 list flagged the
 * paginated leads query at 0% coverage.
 *
 * Why an extraction was preferred over `renderHook`-style React tests:
 *   • `@testing-library/react` is NOT in the project's dependencies.
 *     Adding it would violate the "DO NOT add new dependencies" rule from
 *     the parent prompt.
 *   • The hook is tightly coupled to React Query + supabase auth state, so
 *     even with renderHook the meaningful logic to verify is the supabase
 *     query-builder application — which is now pure code reachable
 *     without any React layer.
 *   • The original useLeads.ts duplicated the filter / sort application
 *     logic THREE times across the three fetch branches. Extraction also
 *     deletes that duplication in production code, which the parent
 *     prompt explicitly permits ("if you need to extract a helper for
 *     testability, that's fine; don't refactor the public API").
 *
 * Coverage focus:
 *   1. applyContractorScope applies eq("contractor_id") in non-godmode
 *   2. applyContractorScope skips the eq() when godmode = true
 *   3. applyLeadFilters applies each filter type correctly
 *   4. applyLeadFilters with status array uses .in(); single status uses .eq()
 *   5. applyLeadFilters geocoded_only adds two .not() clauses
 *   6. applyLeadFilters skips when filters undefined
 *   7. applyLeadSort orders by sortBy + tiebreaker on id when skipSort = false
 *   8. applyLeadSort skips order entirely when skipSort = true
 *   9. resolveSelect returns SELECT_NARROW when extendedColumnsMissing is true,
 *      SELECT_WIDE otherwise
 *  10. dedupRowsById collapses overlapping pages keyed on id
 *  11. dedupRowsById drops rows with no id (defensive)
 *  12. isMissingColumnErr matches both PostgREST phrasings
 *  13. SELECT_NARROW + SELECT_WIDE include the expected core columns
 *  14. SELECT_WIDE is a strict superset of SELECT_NARROW
 */
import { describe, it, expect, vi } from "vitest";
import {
  COLUMNS_NARROW,
  COLUMNS_EXTENDED,
  PERMITS_JOIN,
  SELECT_WIDE,
  SELECT_NARROW,
  isMissingColumnErr,
  applyContractorScope,
  applyLeadFilters,
  applyLeadSort,
  dedupRowsById,
  dedupByAddress,
  resolveSelect,
  type LeadsQueryBuilder,
} from "../useLeads.helpers";
import type { Lead } from "@/types/lead";

/* ── Mock query-builder factory ──
 *
 * Mirrors the pattern from `src/lib/exclusivity/__tests__/locks.test.ts`:
 * each chainable method records the call and returns the same builder, so
 * the test body can assert on the exact sequence + arguments after the
 * helper runs. Real supabase-js builders are also fluent — same shape.
 */
interface MockBuilder extends LeadsQueryBuilder {
  calls: Array<{ method: string; args: unknown[] }>;
}

function makeMockBuilder(): MockBuilder {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: MockBuilder = {
    calls,
    eq: vi.fn((...args) => {
      calls.push({ method: "eq", args });
      return builder;
    }),
    in: vi.fn((...args) => {
      calls.push({ method: "in", args });
      return builder;
    }),
    not: vi.fn((...args) => {
      calls.push({ method: "not", args });
      return builder;
    }),
    gte: vi.fn((...args) => {
      calls.push({ method: "gte", args });
      return builder;
    }),
    lte: vi.fn((...args) => {
      calls.push({ method: "lte", args });
      return builder;
    }),
    order: vi.fn((...args) => {
      calls.push({ method: "order", args });
      return builder;
    }),
  };
  return builder;
}

describe("applyContractorScope", () => {
  it("applies eq('contractor_id', userId) when godMode = false", () => {
    const b = makeMockBuilder();
    applyContractorScope(b, false, "user-123");
    expect(b.calls).toEqual([
      { method: "eq", args: ["contractor_id", "user-123"] },
    ]);
  });

  it("skips the eq filter when godMode = true (founder/dev allowlist)", () => {
    const b = makeMockBuilder();
    applyContractorScope(b, true, "user-123");
    expect(b.calls).toEqual([]);
  });
});

describe("applyLeadFilters", () => {
  it("returns the query unchanged when filters undefined", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, undefined);
    expect(b.calls).toEqual([]);
  });

  it("applies urgency, single status (eq), trade", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, { urgency: "hot", status: "new", trade: "roofing" });
    expect(b.calls).toEqual([
      { method: "eq", args: ["urgency", "hot"] },
      { method: "eq", args: ["status", "new"] },
      { method: "eq", args: ["trade", "roofing"] },
    ]);
  });

  it("uses .in() when status is an array (multi-status filter)", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, { status: ["new", "contacted", "quoted"] });
    expect(b.calls).toEqual([
      { method: "in", args: ["status", ["new", "contacted", "quoted"]] },
    ]);
  });

  it("applies cascade_only as eq(cascade_flag, true)", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, { cascade_only: true });
    expect(b.calls).toEqual([
      { method: "eq", args: ["cascade_flag", true] },
    ]);
  });

  it("applies geocoded_only as two .not() clauses on lat/lng (denormalized)", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, { geocoded_only: true });
    expect(b.calls).toEqual([
      { method: "not", args: ["latitude", "is", null] },
      { method: "not", args: ["longitude", "is", null] },
    ]);
  });

  it("applies min_score and max_score as gte/lte", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, { min_score: 50, max_score: 85 });
    expect(b.calls).toEqual([
      { method: "gte", args: ["score", 50] },
      { method: "lte", args: ["score", 85] },
    ]);
  });

  it("applies all filter types together in stable order", () => {
    const b = makeMockBuilder();
    applyLeadFilters(b, {
      urgency: "warm",
      status: ["new"],
      trade: "hvac",
      cascade_only: true,
      geocoded_only: true,
      min_score: 30,
      max_score: 90,
    });
    expect(b.calls.map((c) => c.method)).toEqual([
      "eq", // urgency
      "in", // status array
      "eq", // trade
      "eq", // cascade_flag
      "not", // latitude
      "not", // longitude
      "gte", // min_score
      "lte", // max_score
    ]);
  });
});

describe("applyLeadSort", () => {
  it("orders by sortBy DESC + id ASC tiebreaker when skipSort = false (default)", () => {
    const b = makeMockBuilder();
    applyLeadSort(b, "score", "desc", false);
    expect(b.calls).toEqual([
      { method: "order", args: ["score", { ascending: false }] },
      { method: "order", args: ["id", { ascending: true }] },
    ]);
  });

  it("orders ASC when sortDir = 'asc'", () => {
    const b = makeMockBuilder();
    applyLeadSort(b, "created_at", "asc", false);
    expect(b.calls).toEqual([
      { method: "order", args: ["created_at", { ascending: true }] },
      { method: "order", args: ["id", { ascending: true }] },
    ]);
  });

  it("skips order entirely when skipSort = true (geocoded_only path)", () => {
    const b = makeMockBuilder();
    applyLeadSort(b, "score", "desc", true);
    expect(b.calls).toEqual([]);
  });
});

describe("resolveSelect", () => {
  it("returns SELECT_NARROW when extendedColumnsMissing = true", () => {
    expect(resolveSelect(true)).toBe(SELECT_NARROW);
  });

  it("returns SELECT_WIDE when extendedColumnsMissing = false", () => {
    expect(resolveSelect(false)).toBe(SELECT_WIDE);
  });
});

describe("dedupRowsById", () => {
  it("drops duplicate rows keyed by id (overlapping pages)", () => {
    const rows = [
      { id: "a", score: 50 },
      { id: "b", score: 60 },
      { id: "a", score: 50 }, // dupe
      { id: "c", score: 70 },
      { id: "b", score: 60 }, // dupe
    ];
    const out = dedupRowsById(rows);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("drops rows missing an id (defensive guard)", () => {
    const rows = [
      { id: "a" },
      { id: undefined as unknown as string },
      { id: "" },
      { id: "b" },
    ];
    const out = dedupRowsById(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns identical array when no duplicates exist", () => {
    const rows = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const out = dedupRowsById(rows);
    expect(out).toEqual(rows);
  });

  it("preserves the FIRST occurrence (not the last) of a duplicate id", () => {
    const rows = [
      { id: "k", score: 1 },
      { id: "k", score: 999 },
    ];
    const out = dedupRowsById(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: "k", score: 1 });
  });
});

describe("dedupByAddress", () => {
  const L = (o: Partial<Lead>) => o as Lead;

  it("collapses multiple permits at the same address to one card", () => {
    // Input ordered by score DESC (as the fetch delivers it).
    const leads = [
      L({ id: "1", address: "80 Seymour St", zip: "06106", score: 69 }),
      L({ id: "2", address: "80 SEYMOUR ST.", zip: "06106", score: 55 }),
      L({ id: "3", address: "80  seymour  st", zip: "06106", score: 40 }),
      L({ id: "4", address: "12 Oak Ave", zip: "06106", score: 60 }),
    ];
    const out = dedupByAddress(leads);
    expect(out).toHaveLength(2);
    // Keeps the top-scored lead for the collapsed address.
    expect(out[0].id).toBe("1");
    expect(out[1].id).toBe("4");
  });

  it("stamps cascade_count with the true permit count at the address", () => {
    const leads = [
      L({ id: "1", address: "80 Seymour St", zip: "06106", score: 69, cascade_count: 1 }),
      L({ id: "2", address: "80 Seymour St", zip: "06106", score: 55, cascade_count: 1 }),
      L({ id: "3", address: "80 Seymour St", zip: "06106", score: 40, cascade_count: 1 }),
    ];
    const out = dedupByAddress(leads);
    expect(out).toHaveLength(1);
    expect((out[0] as { cascade_count?: number }).cascade_count).toBe(3);
  });

  it("does NOT collapse different addresses in the same ZIP", () => {
    const leads = [
      L({ id: "1", address: "1 A St", zip: "06106", score: 50 }),
      L({ id: "2", address: "2 B St", zip: "06106", score: 50 }),
    ];
    expect(dedupByAddress(leads)).toHaveLength(2);
  });

  it("does NOT collapse the same street across different ZIPs", () => {
    const leads = [
      L({ id: "1", address: "1 Main St", zip: "06106", score: 50 }),
      L({ id: "2", address: "1 Main St", zip: "33602", score: 50 }),
    ];
    expect(dedupByAddress(leads)).toHaveLength(2);
  });

  it("never collapses leads with no usable address", () => {
    const leads = [
      L({ id: "1", address: "Unknown", zip: "06106", score: 50 }),
      L({ id: "2", address: "", zip: "06106", score: 50 }),
      L({ id: "3", address: "Unknown", zip: "06106", score: 40 }),
    ];
    expect(dedupByAddress(leads)).toHaveLength(3);
  });
});

describe("isMissingColumnErr", () => {
  it("matches PostgREST 'column does not exist'", () => {
    expect(
      isMissingColumnErr(
        'column "contact_source" of relation "leads" does not exist',
      ),
    ).toBe(true);
  });

  it("matches PostgREST 'Could not find the column'", () => {
    expect(
      isMissingColumnErr(
        "Could not find the column 'employer' on table 'leads'",
      ),
    ).toBe(true);
  });

  it("returns false on unrelated errors (RLS, statement timeout, etc.)", () => {
    expect(isMissingColumnErr("permission denied for table leads")).toBe(false);
    expect(isMissingColumnErr("statement timeout")).toBe(false);
    expect(isMissingColumnErr("")).toBe(false);
  });

  it("is case-insensitive (defensive — PostgREST has flipped phrasing before)", () => {
    expect(isMissingColumnErr("DOES NOT EXIST")).toBe(true);
    expect(isMissingColumnErr("could NOT find THE column")).toBe(true);
  });
});

describe("SELECT constants", () => {
  it("COLUMNS_NARROW contains the expected core fields", () => {
    // Core lead identity + scoring fields the dashboard depends on. These
    // are the columns that must keep working even on pre-migration envs;
    // dropping any of them would crash the dashboard table render.
    const required = [
      "id",
      "contractor_id",
      "permit_id",
      "score",
      "urgency",
      "status",
      "trade",
      "owner_name",
      "score_signals",
      "cascade_flag",
      "latitude",
      "longitude",
    ];
    for (const field of required) {
      expect(COLUMNS_NARROW).toContain(field);
    }
  });

  it("COLUMNS_EXTENDED references the post-migration enrichment fields (00039 + 00044)", () => {
    const required = [
      "contact_source",
      "contact_confidence",
      "employer",
      "occupation",
      "business_phone",
      "license_number",
      "naics_code",
    ];
    for (const field of required) {
      expect(COLUMNS_EXTENDED).toContain(field);
    }
  });

  it("PERMITS_JOIN selects address + permit metadata for the joined permit row", () => {
    const required = [
      "address",
      "city",
      "state",
      "zip",
      "permit_type",
      "applied_date",
      "issued_date",
      "applicant_name",
      "contractor_name",
    ];
    for (const field of required) {
      expect(PERMITS_JOIN).toContain(field);
    }
  });

  it("SELECT_WIDE = COLUMNS_NARROW + COLUMNS_EXTENDED + PERMITS_JOIN", () => {
    expect(SELECT_WIDE).toBe(COLUMNS_NARROW + COLUMNS_EXTENDED + PERMITS_JOIN);
  });

  it("SELECT_NARROW = COLUMNS_NARROW + PERMITS_JOIN (no extended columns)", () => {
    expect(SELECT_NARROW).toBe(COLUMNS_NARROW + PERMITS_JOIN);
  });

  it("SELECT_WIDE is a strict superset of SELECT_NARROW (extended fields only added)", () => {
    // Every column in SELECT_NARROW must also be in SELECT_WIDE; SELECT_WIDE
    // additionally has the extended block. Symmetry check ensures the wide
    // version doesn't accidentally drop a narrow column during a refactor.
    expect(SELECT_WIDE).toContain(COLUMNS_NARROW);
    expect(SELECT_WIDE).toContain(PERMITS_JOIN);
    expect(SELECT_WIDE.length).toBeGreaterThan(SELECT_NARROW.length);
  });
});
