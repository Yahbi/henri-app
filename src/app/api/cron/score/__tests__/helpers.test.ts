/**
 * Tests for `src/app/api/cron/score/helpers.ts` — audit priority #5.
 *
 * The score cron is wedge bullet #2 (transparent scoring) — it scores
 * every unscored permit and round-robin-assigns leads to contractors
 * holding territory in the permit's ZIP. Without these tests a future
 * refactor of `extractOwnerFields` could silently drop a casing variant
 * and the scorer would lose owner/phone/email for an entire jurisdiction.
 *
 * Coverage:
 *   1. pickRawField — first-non-empty across casing variants (snake / Pascal / SCREAMING)
 *   2. pickRawField — null/undefined raw → null
 *   3. pickRawField — whitespace-only string treated as empty
 *   4. extractOwnerFields — first/last/full/phone/email across documented casings
 *   5. extractOwnerFields — null raw → all-null record
 *   6. mapPermitType — free-text → 8-value enum
 *   7. mapPermitType — unknown → "other" (defensive default)
 *   8. dedupKey — case-insensitive + trim-safe
 *   9. normalizeAddrKey — strips punctuation + collapses whitespace
 *  10. normalizeAddrKey — null/empty → null (no orphan keys)
 *  11. assignContractorRoundRobin — fair rotation across N contractors
 *  12. assignContractorRoundRobin — empty contractor list → no orphan leads
 *  13. assignContractorRoundRobin — single contractor + 100 leads → all 100
 *  14. assignContractorRoundRobin — items with null zip dropped
 *  15. assignContractorRoundRobin — independent counters per zip
 */
import { describe, it, expect } from "vitest";
import {
  pickRawField,
  extractOwnerFields,
  mapPermitType,
  dedupKey,
  normalizeAddrKey,
  assignContractorRoundRobin,
} from "../helpers";

describe("pickRawField", () => {
  it("returns the first non-empty string across candidate keys", () => {
    const raw = { OWNER_FIRST: "Adan" };
    expect(pickRawField(raw, ["owner_first", "OwnerFirst", "OWNER_FIRST"])).toBe("Adan");
  });

  it("falls through to later keys when earlier ones are missing/empty", () => {
    const raw = { owner_first: "", OwnerFirst: "  ", OWNER_FIRST: "Maria" };
    // Empty string + whitespace-only treated as missing; SCREAMING_SNAKE wins.
    expect(pickRawField(raw, ["owner_first", "OwnerFirst", "OWNER_FIRST"])).toBe("Maria");
  });

  it("trims whitespace from the returned value", () => {
    const raw = { owner_name: "  Acme Corp  " };
    expect(pickRawField(raw, ["owner_name"])).toBe("Acme Corp");
  });

  it("returns null when raw is null/undefined", () => {
    expect(pickRawField(null, ["owner_name"])).toBeNull();
    expect(pickRawField(undefined, ["owner_name"])).toBeNull();
  });

  it("returns null when no candidate keys match", () => {
    const raw = { unrelated_field: "value" };
    expect(pickRawField(raw, ["owner_first", "owner_last"])).toBeNull();
  });

  it("ignores non-string values (numbers, booleans, objects)", () => {
    const raw = { owner_phone: 5551234567, owner_name: { full: "x" } };
    expect(pickRawField(raw, ["owner_phone"])).toBeNull();
    expect(pickRawField(raw, ["owner_name"])).toBeNull();
  });

  it("respects key order — earliest non-empty wins", () => {
    const raw = { OwnerFirst: "Bob", OWNER_FIRST: "Alice" };
    expect(pickRawField(raw, ["OwnerFirst", "OWNER_FIRST"])).toBe("Bob");
    expect(pickRawField(raw, ["OWNER_FIRST", "OwnerFirst"])).toBe("Alice");
  });
});

describe("extractOwnerFields", () => {
  it("extracts CT open-data style snake_case keys", () => {
    const raw = {
      owner_first: "Adan",
      owner_last: "Martinez",
      owner_name: "Adan Martinez",
      owner_phone: "555-0100",
      owner_email: "adan@example.com",
      contractor_name: "Acme Plumbing",
    };
    const out = extractOwnerFields(raw);
    expect(out.first).toBe("Adan");
    expect(out.last).toBe("Martinez");
    expect(out.full).toBe("Adan Martinez");
    expect(out.phone).toBe("555-0100");
    expect(out.email).toBe("adan@example.com");
    expect(out.contractor).toBe("Acme Plumbing");
  });

  it("extracts LA-city SCREAMING_SNAKE_CASE keys", () => {
    const raw = {
      OWNER_NAME: "Maria Garcia",
      APPLICANT_NAME: "Maria Garcia",
      PHONE: "323-555-0100",
      CONTRACTOR_NAME: "ACME ROOFING",
    };
    const out = extractOwnerFields(raw);
    expect(out.full).toBe("Maria Garcia");
    expect(out.phone).toBe("323-555-0100");
    expect(out.contractor).toBe("ACME ROOFING");
  });

  it("extracts Miami-Dade PascalCase keys", () => {
    const raw = {
      OwnerFirst: "Carlos",
      OwnerLast: "Rivera",
      OwnerName: "Carlos Rivera",
      OwnerPhone: "305-555-0100",
      OwnerEmail: "carlos@example.com",
    };
    const out = extractOwnerFields(raw);
    expect(out.first).toBe("Carlos");
    expect(out.last).toBe("Rivera");
    expect(out.full).toBe("Carlos Rivera");
    expect(out.phone).toBe("305-555-0100");
    expect(out.email).toBe("carlos@example.com");
  });

  it("falls back to applicant_* when owner_* missing", () => {
    const raw = {
      applicant_first: "Pat",
      applicant_last: "Smith",
      applicant_name: "Pat Smith",
      applicant_phone: "555-0199",
      applicant_email: "pat@example.com",
    };
    const out = extractOwnerFields(raw);
    expect(out.first).toBe("Pat");
    expect(out.last).toBe("Smith");
    expect(out.full).toBe("Pat Smith");
    expect(out.phone).toBe("555-0199");
    expect(out.email).toBe("pat@example.com");
  });

  it("returns all-null when raw is null", () => {
    const out = extractOwnerFields(null);
    expect(out.first).toBeNull();
    expect(out.last).toBeNull();
    expect(out.full).toBeNull();
    expect(out.phone).toBeNull();
    expect(out.email).toBeNull();
    expect(out.contractor).toBeNull();
  });

  it("returns all-null when raw is empty {}", () => {
    const out = extractOwnerFields({});
    expect(out.first).toBeNull();
    expect(out.full).toBeNull();
  });
});

describe("mapPermitType", () => {
  it("maps demolition keywords", () => {
    expect(mapPermitType("Residential Demolition Permit")).toBe("demolition");
    expect(mapPermitType("Wrecking Permit-1-2 Family")).toBe("demolition");
    expect(mapPermitType("Demolish Garage")).toBe("demolition");
  });

  it("maps new construction (more specific than 'new')", () => {
    expect(mapPermitType("New Construction Permit")).toBe("new_construction");
    expect(mapPermitType("New Building")).toBe("new_construction");
    expect(mapPermitType("Construct New Single Family")).toBe("new_construction");
  });

  it("maps renovation/alteration/remodel/TI", () => {
    expect(mapPermitType("Residential Alteration Permit")).toBe("renovation");
    expect(mapPermitType("Tenant Improvement")).toBe("renovation");
    expect(mapPermitType("Bathroom Remodel")).toBe("renovation");
    expect(mapPermitType("Interior Buildout")).toBe("renovation");
    expect(mapPermitType("Renovation Project")).toBe("renovation");
  });

  it("maps addition", () => {
    expect(mapPermitType("Residential Addition")).toBe("addition");
    expect(mapPermitType("ADD-ON GARAGE")).toBe("addition");
  });

  it("maps repair", () => {
    expect(mapPermitType("Foundation Repair")).toBe("repair");
    expect(mapPermitType("REPAIR PERMIT")).toBe("repair");
  });

  it("maps commercial vs residential", () => {
    expect(mapPermitType("Commercial Plumbing")).toBe("commercial");
    expect(mapPermitType("Non-Residential Building")).toBe("commercial");
    expect(mapPermitType("Residential Plumbing Permit")).toBe("residential");
    expect(mapPermitType("Single Family Dwelling")).toBe("residential");
    expect(mapPermitType("1-2 Family Electrical")).toBe("residential");
  });

  it("defaults to 'other' for unknown text", () => {
    expect(mapPermitType("Sign Permit")).toBe("other");
    expect(mapPermitType("Legacy")).toBe("other");
    expect(mapPermitType("")).toBe("other");
  });

  it("defaults to 'other' for null/undefined input", () => {
    expect(mapPermitType(null)).toBe("other");
    expect(mapPermitType(undefined)).toBe("other");
  });
});

describe("dedupKey", () => {
  it("lowercases + trims permit number and city", () => {
    expect(dedupKey("ABC-123", "Dallas")).toBe("abc-123::dallas");
    expect(dedupKey("  ABC-123  ", "  Dallas  ")).toBe("abc-123::dallas");
  });

  it("handles null/undefined city", () => {
    expect(dedupKey("ABC-123", null)).toBe("abc-123::");
    expect(dedupKey("ABC-123", undefined)).toBe("abc-123::");
  });

  it("preserves separator between equal-permit-different-city", () => {
    expect(dedupKey("ABC-123", "Dallas")).not.toBe(dedupKey("ABC-123", "Houston"));
  });
});

describe("normalizeAddrKey", () => {
  it("lowercases + strips .,# + collapses spaces + appends |zip", () => {
    expect(normalizeAddrKey("123 Main St., Apt #4", "75217"))
      .toBe("123 main st apt 4|75217");
  });

  it("appends empty zip when zip missing", () => {
    expect(normalizeAddrKey("123 Main St", null)).toBe("123 main st|");
    expect(normalizeAddrKey("123 Main St", undefined)).toBe("123 main st|");
  });

  it("returns null for null/empty addresses", () => {
    expect(normalizeAddrKey(null, "75217")).toBeNull();
    expect(normalizeAddrKey(undefined, "75217")).toBeNull();
    expect(normalizeAddrKey("", "75217")).toBeNull();
    expect(normalizeAddrKey("   ", "75217")).toBeNull();
  });

  it("collapses multi-space + trims", () => {
    expect(normalizeAddrKey("  123    Main   St  ", "10001"))
      .toBe("123 main st|10001");
  });
});

describe("assignContractorRoundRobin", () => {
  it("3 contractors × 9 leads → each contractor gets 3 in fair rotation", () => {
    const zipMap = new Map<string, string[]>([
      ["90210", ["c-A", "c-B", "c-C"]],
    ]);
    const items = Array.from({ length: 9 }, (_, i) => ({
      payload: `lead-${i}`,
      zip: "90210",
    }));
    const out = assignContractorRoundRobin(zipMap, items);

    expect(out).toHaveLength(9);
    // Round-robin: A,B,C,A,B,C,A,B,C
    expect(out.map((o) => o.contractor)).toEqual([
      "c-A", "c-B", "c-C",
      "c-A", "c-B", "c-C",
      "c-A", "c-B", "c-C",
    ]);
    // Each contractor served exactly 3 times
    const counts = new Map<string, number>();
    for (const a of out) {
      counts.set(a.contractor, (counts.get(a.contractor) ?? 0) + 1);
    }
    expect(counts.get("c-A")).toBe(3);
    expect(counts.get("c-B")).toBe(3);
    expect(counts.get("c-C")).toBe(3);
  });

  it("empty contractor list for the zip → leads excluded (no orphan leads)", () => {
    const zipMap = new Map<string, string[]>([
      ["90210", []], // explicitly empty
    ]);
    const items = [
      { payload: "lead-1", zip: "90210" },
      { payload: "lead-2", zip: "90210" },
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out).toHaveLength(0);
  });

  it("zip missing from map → leads excluded (no orphan leads)", () => {
    const zipMap = new Map<string, string[]>(); // empty map
    const items = [
      { payload: "lead-1", zip: "30303" },
      { payload: "lead-2", zip: "30303" },
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out).toHaveLength(0);
  });

  it("1 contractor + 100 leads → all 100 go to that contractor", () => {
    const zipMap = new Map<string, string[]>([
      ["10001", ["solo-contractor"]],
    ]);
    const items = Array.from({ length: 100 }, (_, i) => ({
      payload: `lead-${i}`,
      zip: "10001",
    }));
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out).toHaveLength(100);
    expect(out.every((o) => o.contractor === "solo-contractor")).toBe(true);
  });

  it("items with null/empty zip are skipped (no contractor inferred)", () => {
    const zipMap = new Map<string, string[]>([
      ["90210", ["c-A"]],
    ]);
    const items = [
      { payload: "lead-A", zip: "90210" },
      { payload: "lead-B", zip: null },
      { payload: "lead-C", zip: "" },
      { payload: "lead-D", zip: "90210" },
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out).toHaveLength(2);
    expect(out[0].payload).toBe("lead-A");
    expect(out[1].payload).toBe("lead-D");
  });

  it("counters are independent per zip", () => {
    // 2 contractors in 90210, 2 in 30303. Interleave items between zips.
    // The 30303 counter shouldn't advance when a 90210 lead is assigned.
    const zipMap = new Map<string, string[]>([
      ["90210", ["A1", "A2"]],
      ["30303", ["B1", "B2"]],
    ]);
    const items = [
      { payload: "p1", zip: "90210" }, // A1
      { payload: "p2", zip: "30303" }, // B1
      { payload: "p3", zip: "90210" }, // A2
      { payload: "p4", zip: "30303" }, // B2
      { payload: "p5", zip: "90210" }, // A1 (wrap)
      { payload: "p6", zip: "30303" }, // B1 (wrap)
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out.map((o) => o.contractor)).toEqual([
      "A1", "B1", "A2", "B2", "A1", "B1",
    ]);
  });

  it("payload is passed through unchanged (object identity preserved)", () => {
    const zipMap = new Map<string, Array<{ id: string }>>([
      ["90210", [{ id: "c-A" }]],
    ]);
    const payload1 = { permit_id: "permit-1", score: 87 };
    const payload2 = { permit_id: "permit-2", score: 65 };
    const items = [
      { payload: payload1, zip: "90210" },
      { payload: payload2, zip: "90210" },
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out[0].payload).toBe(payload1);
    expect(out[1].payload).toBe(payload2);
  });

  it("preserves order of items in the output", () => {
    const zipMap = new Map<string, string[]>([
      ["10001", ["solo"]],
    ]);
    const items = [
      { payload: "first", zip: "10001" },
      { payload: "second", zip: "10001" },
      { payload: "third", zip: "10001" },
    ];
    const out = assignContractorRoundRobin(zipMap, items);
    expect(out.map((o) => o.payload)).toEqual(["first", "second", "third"]);
  });
});
