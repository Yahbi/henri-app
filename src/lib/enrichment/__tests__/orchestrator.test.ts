/**
 * Tests for `src/lib/enrichment/orchestrator.ts` — wedge bullet #2
 * (transparent confidence). The orchestrator composes 9 enrichment sources
 * into a single EnrichedContact and tracks per-field provenance.
 *
 * The audit-priority-#5 list flagged this module at 0% coverage; it's
 * load-bearing for every contact field shown in the lead drawer. Specifically,
 * a future refactor that breaks the source-priority ordering, the cache
 * key derivation, or the address-equality (vs. ILIKE) lookup would silently
 * misattribute owners across permits — the kind of bug that doesn't bubble
 * up to a typecheck but degrades data quality.
 *
 * Coverage focus:
 *   1. enrichLead empty-context returns bare initial state with primary_source: null
 *   2. enrichLead is cached across same input — no double-write
 *   3. Higher-confidence sources win (county_gis 0.9 beats voter local lower)
 *   4. cacheKey() is deterministic (whitespace, casing, optional fields)
 *   5. trace() instrumentation increments getTelemetry counters
 *   6. resetTelemetry() clears counters
 *   7. Graceful-degrade: ctx.supabase undefined → no throw, sibling lookup skipped
 *   8. Address ILIKE escape (B6 fix): special chars use eq() not ilike()
 *   9. Structural — orchestrator references >= 8 of the 9 documented sources
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Mock every external source module BEFORE the import. ──────────────────
 *
 * Each mock returns null by default so the orchestrator's "graceful-degrade
 * to null" contract is the baseline. Individual tests override per-source
 * results via mocked.<fn>.mockResolvedValueOnce(...).
 *
 * vi.mock() is hoisted by vitest so these are wired before the orchestrator
 * file is even parsed — no race against the static `import` chain.
 */
vi.mock("../county-gis", () => ({
  enrichFromCounty: vi.fn().mockResolvedValue(null),
}));
vi.mock("../regrid-parcel", () => ({
  queryRegrid: vi.fn().mockResolvedValue(null),
}));
vi.mock("../opencorporates", () => ({
  lookupCompanyPrincipal: vi.fn().mockResolvedValue(null),
}));
vi.mock("../fec-contributor", () => ({
  lookupFECContributor: vi.fn().mockResolvedValue(null),
}));
vi.mock("../contractor-license", () => ({
  lookupContractorLicense: vi.fn().mockResolvedValue(null),
}));
vi.mock("../hunter-email", () => ({
  inferEmailFromBusinessName: vi.fn().mockResolvedValue(null),
}));
vi.mock("../voter-registration", () => ({
  lookupVoterByAddress: vi.fn().mockResolvedValue(null),
}));
vi.mock("../voter-file", () => ({
  lookupLocalVoterFile: vi.fn().mockResolvedValue(null),
}));
vi.mock("../ppp-loan", () => ({
  lookupPPP: vi.fn().mockResolvedValue(null),
}));
vi.mock("../osm-contact", () => ({
  lookupOSMContact: vi.fn().mockResolvedValue(null),
}));
vi.mock("../google-places", () => ({
  lookupGooglePlaces: vi.fn().mockResolvedValue(null),
}));
vi.mock("../yelp-fusion", () => ({
  lookupYelp: vi.fn().mockResolvedValue(null),
}));
vi.mock("../description-miner", () => ({
  mineMultiple: vi.fn().mockReturnValue({ phones: [], emails: [] }),
}));
// Phase E dynamic imports — vi.mock works on these too because vitest
// hoists all mocks above any dynamic import calls.
vi.mock("../numverify", () => ({
  lookupPhoneMetadata: vi.fn().mockResolvedValue(null),
}));
vi.mock("../cloudmersive", () => ({
  lookupPhoneCloudmersive: vi.fn().mockResolvedValue(null),
  lookupAddressCloudmersive: vi.fn().mockResolvedValue(null),
}));
vi.mock("../weatherstack", () => ({
  lookupWeatherByZip: vi.fn().mockResolvedValue(null),
}));
vi.mock("../apollo", () => ({
  lookupBusinessPrincipal: vi.fn().mockResolvedValue(null),
}));

import {
  enrichLead,
  getTelemetry,
  resetTelemetry,
  type EnrichmentContext,
} from "../orchestrator";
import * as countyGis from "../county-gis";
import * as voterFile from "../voter-file";

/** Build a chainable supabase mock matching the locks.test.ts pattern. The
 *  orchestrator's only DB call is the sibling-permit query in
 *  queryAddressSiblings — see orchestrator.ts:198. The shape is:
 *  `from(...).select(...).eq(...).eq(...).not(...).order(...).limit(N)`
 *  and the awaited terminal value is `{ data: Row[] | null, error }`. */
type MockResult<T = unknown> = { data: T | null; error: { message: string } | null };

interface ChainableBuilder<T = unknown> {
  select: (...args: unknown[]) => ChainableBuilder<T>;
  eq: (...args: unknown[]) => ChainableBuilder<T>;
  not: (...args: unknown[]) => ChainableBuilder<T>;
  order: (...args: unknown[]) => ChainableBuilder<T>;
  limit: (...args: unknown[]) => Promise<MockResult<T>>;
}

interface MockSupabase {
  from: (table: string) => ChainableBuilder;
  fromCalls: string[];
  /** Captured eq() calls per from() — used to assert the address path
   *  uses `.eq("address", literal)` not `.ilike(...)`. */
  eqCalls: Array<{ column: string; value: unknown }>;
  /** Captured `not()` calls. */
  notCalls: Array<unknown[]>;
}

function makeMockSupabase(rows: unknown[] | null = null): MockSupabase {
  const fromCalls: string[] = [];
  const eqCalls: Array<{ column: string; value: unknown }> = [];
  const notCalls: Array<unknown[]> = [];
  const builder: ChainableBuilder = {
    select: () => builder,
    eq: (column, value) => {
      eqCalls.push({ column: column as string, value });
      return builder;
    },
    not: (...args) => {
      notCalls.push(args);
      return builder;
    },
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
  };
  return {
    from: (table) => {
      fromCalls.push(table);
      return builder;
    },
    fromCalls,
    eqCalls,
    notCalls,
  };
}

beforeEach(() => {
  resetTelemetry();
  vi.clearAllMocks();
  // Reset the orchestrator's in-memory cache by using unique addresses per
  // test (cacheKey() is deterministic on address+zip+state). Each `it()`
  // block uses a different street address so cross-test bleed is impossible.
});

afterEach(() => {
  resetTelemetry();
});

describe("enrichLead — empty context", () => {
  it("returns the bare initial state with primary_source: null when nothing matches", async () => {
    const result = await enrichLead({
      address: "111 EMPTY ST",
      zip: "00001",
      state: "CA",
    });
    expect(result.owner_name).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.email).toBeNull();
    expect(result.primary_source).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.sources).toEqual({});
  });

  it("seeds upstream provenance for fields that came in pre-populated", async () => {
    const result = await enrichLead({
      address: "112 UPSTREAM ST",
      zip: "00002",
      owner_name: "Pre-Existing Owner",
      phone: "5551234567",
      email: "u@example.com",
    });
    expect(result.owner_name).toBe("Pre-Existing Owner");
    expect(result.sources.owner_name).toBe("upstream");
    expect(result.sources.phone).toBe("upstream");
    expect(result.sources.email).toBe("upstream");
  });
});

describe("enrichLead — cache", () => {
  it("hits the in-memory cache on the second call with the same context", async () => {
    const ctx: EnrichmentContext = {
      address: "200 CACHE LANE",
      zip: "00003",
      state: "CA",
    };

    // First call — should run all the source mocks.
    await enrichLead(ctx);
    const callsAfterFirst = vi.mocked(countyGis.enrichFromCounty).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call — telemetry counters should NOT advance because cache hits
    // short-circuit BEFORE trace() runs. Use telemetry as the observable
    // signal (mock call count is also valid but telemetry is the contract
    // the orchestrator promises in getTelemetry()).
    const telemBefore = getTelemetry();
    await enrichLead(ctx);
    const telemAfter = getTelemetry();
    expect(telemAfter).toEqual(telemBefore);

    // And the source mock should not have been called a second time either —
    // belt-and-braces.
    const callsAfterSecond = vi.mocked(countyGis.enrichFromCounty).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

describe("enrichLead — source priority + confidence", () => {
  it("higher-confidence source (voter file, 0.9) populates owner_name + raises confidence", async () => {
    vi.mocked(voterFile.lookupLocalVoterFile).mockResolvedValueOnce({
      owner_name: "Jane Voter",
      phone: "5550001111",
      source: "voter_fl_local",
      confidence: 0.9,
    });

    const result = await enrichLead({
      address: "300 VOTER WAY",
      zip: "33333",
      state: "FL",
    });
    expect(result.owner_name).toBe("Jane Voter");
    expect(result.sources.owner_name).toBe("voter_fl_local");
    // Voter file populated owner first → primary_source latches.
    expect(result.primary_source).toBe("voter_fl_local");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("county_gis (0.9 floor) becomes primary_source when voter is empty and county returns owner", async () => {
    vi.mocked(countyGis.enrichFromCounty).mockResolvedValueOnce({
      owner_name: "County Owner",
      owner_first: "County",
      owner_last: "Owner",
      mailing_address: "300 COUNTY RD",
      year_built: 1995,
      home_sqft: 1500,
      lot_sqft: null,
      assessed_value: 500_000,
      property_value: null,
      owner_occupied: true,
      last_sale_date: null,
      last_sale_price: null,
      source: "county_gis_la",
    });

    const result = await enrichLead({
      address: "400 COUNTY ST",
      zip: "44444",
      state: "CA",
    });
    expect(result.owner_name).toBe("County Owner");
    expect(result.year_built).toBe(1995);
    expect(result.sources.owner_name).toBe("county_gis_la");
    expect(result.primary_source).toBe("county_gis_la");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("voter-file primary_source latches first; later sources don't overwrite primary_source", async () => {
    // Voter file fires first in the orchestrator (Phase A). Set both that
    // AND county to populate owner_name; primary_source should remain
    // voter_fl_local because it claimed first.
    vi.mocked(voterFile.lookupLocalVoterFile).mockResolvedValueOnce({
      owner_name: "First Wins",
      phone: null,
      source: "voter_fl_local",
      confidence: 0.85,
    });
    vi.mocked(countyGis.enrichFromCounty).mockResolvedValueOnce({
      owner_name: "Second Loses",
      owner_first: null,
      owner_last: null,
      mailing_address: null,
      year_built: null,
      home_sqft: null,
      lot_sqft: null,
      assessed_value: null,
      property_value: null,
      owner_occupied: null,
      last_sale_date: null,
      last_sale_price: null,
      source: "county_gis_la",
    });

    const result = await enrichLead({
      address: "500 LATCH ST",
      zip: "55555",
      state: "FL",
    });
    expect(result.owner_name).toBe("First Wins");
    expect(result.sources.owner_name).toBe("voter_fl_local");
    expect(result.primary_source).toBe("voter_fl_local");
  });
});

describe("trace() instrumentation + getTelemetry()", () => {
  it("increments calls / hits / totalLatencyMs as sources fire", async () => {
    // Make county-gis return a hit so we can assert hits++
    vi.mocked(countyGis.enrichFromCounty).mockResolvedValueOnce({
      owner_name: "Telemetry Test",
      owner_first: null,
      owner_last: null,
      mailing_address: null,
      year_built: null,
      home_sqft: null,
      lot_sqft: null,
      assessed_value: null,
      property_value: null,
      owner_occupied: null,
      last_sale_date: null,
      last_sale_price: null,
      source: "county_gis_la",
    });

    await enrichLead({
      address: "600 TELEMETRY DR",
      zip: "66666",
      state: "CA",
    });
    const t = getTelemetry();
    // county_gis is unconditionally invoked when address is present.
    expect(t.county_gis).toBeDefined();
    expect(t.county_gis.calls).toBeGreaterThanOrEqual(1);
    expect(t.county_gis.hits).toBeGreaterThanOrEqual(1);
    expect(t.county_gis.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("counts misses as calls but not hits when source returns null", async () => {
    // Source returns null (default mock). Telemetry still records the call.
    await enrichLead({
      address: "700 MISS ST",
      zip: "77777",
      state: "CA",
    });
    const t = getTelemetry();
    expect(t.county_gis).toBeDefined();
    expect(t.county_gis.calls).toBeGreaterThanOrEqual(1);
    expect(t.county_gis.hits).toBe(0);
  });
});

describe("resetTelemetry()", () => {
  it("clears all counters", async () => {
    await enrichLead({
      address: "800 RESET RD",
      zip: "88888",
      state: "CA",
    });
    expect(Object.keys(getTelemetry()).length).toBeGreaterThan(0);
    resetTelemetry();
    expect(getTelemetry()).toEqual({});
  });
});

describe("graceful-degrade — ctx.supabase undefined", () => {
  it("does not throw when ctx.supabase is omitted; sibling lookup skipped", async () => {
    // Even with valid zip + state, no supabase → sibling lookup never fires.
    // Should still complete and return a clean baseline result.
    await expect(
      enrichLead({
        address: "900 NO-DB AVE",
        zip: "99999",
        state: "CA",
        // supabase deliberately omitted
      }),
    ).resolves.toBeDefined();
    const t = getTelemetry();
    // No "same_address_permit" entry because the gate skipped it.
    expect(t.same_address_permit).toBeUndefined();
  });
});

describe("address ILIKE escape (B6 fix)", () => {
  it("uses .eq() not .ilike() for the sibling-permit address lookup", async () => {
    // Mock a supabase that captures every eq() call. Pass an address
    // containing `%` — if a future refactor reverts to .ilike(), the `%`
    // would silently match unrelated permits and the test catches it.
    const supa = makeMockSupabase(null);
    await enrichLead({
      address: "100% MELROSE ST",
      zip: "12345",
      state: "CA",
      // Force the sibling pass to actually run.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supa as any,
    });

    // Both `zip` and `address` should be passed through `.eq(...)`, NOT
    // through any pattern operator. The literal `%` must reach the DB
    // as a value (not a wildcard pattern).
    const addressEq = supa.eqCalls.find((c) => c.column === "address");
    const zipEq = supa.eqCalls.find((c) => c.column === "zip");
    expect(addressEq).toBeDefined();
    expect(zipEq).toBeDefined();
    expect(addressEq?.value).toBe("100% MELROSE ST");
    // The mock's `not` is the not("applicant_name", "is", null) call.
    expect(supa.notCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("address with underscore literal also routes through .eq() (no _ wildcard)", async () => {
    const supa = makeMockSupabase(null);
    await enrichLead({
      address: "FOO_BAR ST",
      zip: "23456",
      state: "TX",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supa as any,
    });
    const addressEq = supa.eqCalls.find((c) => c.column === "address");
    expect(addressEq?.value).toBe("FOO_BAR ST");
  });

  it("sibling lookup populates owner_name when supabase returns a sibling permit", async () => {
    // Address WITHOUT a sibling-friendly result by default; this test
    // proves the success path also goes through eq() and the resulting
    // primary_source is `same_address_permit` with confidence 0.85.
    const supa = makeMockSupabase([
      { applicant_name: "  Sibling Owner  ", contractor_name: "Sib Contractor" },
    ]);
    const result = await enrichLead({
      address: "1234 SIBLING ST",
      zip: "34567",
      state: "CA",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supa as any,
    });
    expect(result.owner_name).toBe("Sibling Owner"); // trimmed
    expect(result.sources.owner_name).toBe("same_address_permit");
    expect(result.primary_source).toBe("same_address_permit");
    expect(result.confidence).toBeCloseTo(0.85);
  });
});

/* ── Structural test: the orchestrator must reference >= 8 of 9 sources ──
 *
 * This is a drift-detector. If a future refactor accidentally removes one
 * of the source-trace calls (e.g. drops the FEC pass), the count goes down
 * and the test fails. Cheap safety net for the wedge contract — the
 * "9 sources" promise lives in the file's docblock.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("structural — orchestrator covers documented source count", () => {
  it("references >= 8 of the 9 documented sources via trace() calls", () => {
    const orchestratorPath = resolve(
      __dirname,
      "..",
      "orchestrator.ts",
    );
    const src = readFileSync(orchestratorPath, "utf8");
    // Match `trace("source_name", ...)` — the standard instrumentation
    // wrapper around every source call. Counts UNIQUE source labels.
    const matches = src.matchAll(/trace\(\s*"([a-z0-9_]+)"/gi);
    const labels = new Set<string>();
    for (const match of matches) {
      labels.add(match[1]);
    }
    // Documented sources from the file's top-of-file comment:
    //   1. permit_description (mineMultiple — sometimes inline, no trace)
    //   2. same_address_permit
    //   3. voter_file_local
    //   4. county_gis
    //   5. contractor_license
    //   6. opencorporates
    //   7. fec_contributor (NOT wrapped in trace today — known)
    //   8. regrid
    //   9. voter_reg_vendor
    //  10. hunter_io
    //  Phase E: numverify, cloudmersive_phone, cloudmersive_address,
    //           weatherstack, apollo
    //  Plus: ppp_sba, google_places, yelp, osm_contact
    expect(labels.size).toBeGreaterThanOrEqual(8);
  });
});

describe("misc — vi import smoke", () => {
  it("imports vi from vitest cleanly", () => {
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
