/**
 * Tests for the pure decision helpers exported by
 * `src/app/api/cron/score/route.ts`.
 *
 * Two 2026-08-06 fixes are locked here. Both destroyed or misrouted real
 * customer data and both were invisible to the cron_runs success counter.
 *
 *  A. Contact-column omission. The lead upsert used to send
 *     owner_name/owner_first/owner_last/phone/email unconditionally, sourced
 *     only from `permits.raw_json`. `merge-duplicates` writes every column it
 *     is given, so a null erased whatever /api/cron/enrich had just found —
 *     and enrich clears `permits.scored_at` on success, re-queueing the very
 *     lead it enriched. Homeowner phone fill is 1%; this was destroying the
 *     scarcest data in the product.
 *
 *     The omission only works if the key is absent from EVERY row in one
 *     request, because supabase-js derives `?columns=` from the union of all
 *     rows' keys and PostgREST NULLs any listed column a row omits. Hence
 *     `groupByContactColumns`.
 *
 *  B. Trade-aware routing. Migration 00135 made exclusivity one contractor
 *     per trade per ZIP (unique index on (zip, trade) WHERE status='active').
 *     Two contractors in one ZIP are therefore necessarily different trades,
 *     so the old `contractors[counter % contractors.length]` rotation was
 *     guaranteed misrouting rather than fair-share allocation.
 *
 * The route module is imported for its exports only; its heavy dependencies
 * are mocked so nothing touches Supabase or the network.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  ENRICHABLE_CONTACT_COLUMNS,
  omitNullContactColumns,
  contactColumnSignature,
  groupByContactColumns,
  resolvePermitTrade,
  resolveTerritoryHolder,
  type TerritoryHolder,
} from "../route";

/* ── Fix A: never write a null over enriched contact data ───────────────── */

describe("omitNullContactColumns", () => {
  it("drops every null contact column so the upsert cannot erase enrichment", () => {
    const row = omitNullContactColumns({
      permit_id: "p1",
      contractor_id: "c1",
      owner_name: null,
      owner_first: null,
      owner_last: null,
      phone: null,
      email: null,
      score: 61,
    });

    for (const key of ENRICHABLE_CONTACT_COLUMNS) {
      expect(key in row).toBe(false);
    }
    // Non-contact columns are untouched — including their nulls, which the
    // scorer is the authority for.
    expect(row.permit_id).toBe("p1");
    expect(row.score).toBe(61);
  });

  it("keeps permit-derived values so a fresh lead is still populated", () => {
    const row = omitNullContactColumns({
      owner_name: "Dana Kim",
      owner_first: null,
      owner_last: null,
      phone: "813-555-0177",
      email: null,
    });

    expect(row.owner_name).toBe("Dana Kim");
    expect(row.phone).toBe("813-555-0177");
    expect("owner_first" in row).toBe(false);
    expect("owner_last" in row).toBe(false);
    expect("email" in row).toBe(false);
  });

  it("drops undefined as well as null", () => {
    const row = omitNullContactColumns({ phone: undefined, email: null });
    expect("phone" in row).toBe(false);
    expect("email" in row).toBe(false);
  });

  it("keeps an empty string — that is a value the feed shipped, not a gap", () => {
    const row = omitNullContactColumns({ owner_name: "" });
    expect("owner_name" in row).toBe(true);
    expect(row.owner_name).toBe("");
  });

  it("does not mutate the input row", () => {
    const input: Record<string, unknown> = { phone: null, score: 61 };
    const out = omitNullContactColumns(input);
    expect("phone" in input).toBe(true);
    expect(out).not.toBe(input);
  });

  it("leaves nulls on columns the scorer owns (status/notes are absent anyway)", () => {
    const row = omitNullContactColumns({
      cross_trade_suggestions: null,
      opportunity_stage: null,
      phone: null,
    });
    expect("cross_trade_suggestions" in row).toBe(true);
    expect("opportunity_stage" in row).toBe(true);
    expect("phone" in row).toBe(false);
  });
});

describe("groupByContactColumns", () => {
  it("keeps rows with the same contact columns in one group", () => {
    const rows = [
      { permit_id: "a", owner_name: "A" },
      { permit_id: "b", owner_name: "B" },
    ];
    const groups = groupByContactColumns(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("separates a row carrying phone from rows that omit it", () => {
    // This is the whole point: one row with `phone` would otherwise put
    // `phone` into the request's ?columns= union and PostgREST would write
    // NULL for every row that omitted it — re-erasing the enriched value.
    const rows = [
      { permit_id: "a", owner_name: "A" },
      { permit_id: "b", owner_name: "B", phone: "813-555-0177" },
      { permit_id: "c" },
    ];
    const groups = groupByContactColumns(rows);
    expect(groups).toHaveLength(3);

    for (const group of groups) {
      const signatures = new Set(group.map(contactColumnSignature));
      expect(signatures.size).toBe(1);
    }
  });

  it("every input row lands in exactly one group", () => {
    const rows = [
      { permit_id: "a", owner_name: "A" },
      { permit_id: "b", phone: "1" },
      { permit_id: "c", owner_name: "C" },
      { permit_id: "d" },
      { permit_id: "e", phone: "2" },
    ];
    const groups = groupByContactColumns(rows);
    const flat = groups.flat();
    expect(flat).toHaveLength(rows.length);
    expect(new Set(flat.map((r) => r.permit_id)).size).toBe(rows.length);
  });

  it("preserves row order inside a group", () => {
    const rows = [
      { permit_id: "a", owner_name: "A" },
      { permit_id: "b", phone: "1" },
      { permit_id: "c", owner_name: "C" },
    ];
    const groups = groupByContactColumns(rows);
    const nameGroup = groups.find((g) => contactColumnSignature(g[0]) === "owner_name");
    expect(nameGroup?.map((r) => r.permit_id)).toEqual(["a", "c"]);
  });

  it("empty input → no groups (the caller skips the upsert entirely)", () => {
    expect(groupByContactColumns([])).toEqual([]);
  });

  it("signature lists only contact columns, in a stable order", () => {
    expect(
      contactColumnSignature({ phone: "1", owner_name: "n", score: 61 }),
    ).toBe("owner_name,phone");
    expect(contactColumnSignature({ score: 61 })).toBe("");
  });
});

/* ── Fix B: route on (zip, trade), never round-robin ────────────────────── */

describe("resolvePermitTrade", () => {
  it("prefers raw_json.normalized_trade — same source leads.trade is written from", () => {
    expect(resolvePermitTrade({ normalized_trade: "roofing" }, "residential"))
      .toBe("roofing");
  });

  it("falls back to permit_type when normalized_trade is absent", () => {
    expect(resolvePermitTrade({}, "Plumbing")).toBe("plumbing");
    expect(resolvePermitTrade(null, "HVAC")).toBe("hvac");
  });

  it("lower-cases and trims so it can match the trade_type enum", () => {
    expect(resolvePermitTrade({ normalized_trade: "  Electrical  " }, null))
      .toBe("electrical");
  });

  it("returns null when neither field carries a value", () => {
    expect(resolvePermitTrade(null, null)).toBeNull();
    expect(resolvePermitTrade({}, undefined)).toBeNull();
    expect(resolvePermitTrade({ normalized_trade: "   " }, null)).toBeNull();
  });

  it("mirrors leads.trade's `??`: a non-string normalized_trade shadows permit_type", () => {
    // `leads.trade` is written as `raw_json.normalized_trade ?? permit_type`,
    // so a present-but-non-string value wins there too. Returning null keeps
    // routing and the stored column from disagreeing; null takes the
    // no-trade-signal path, which assigns the ZIP's holder rather than
    // guessing a trade the lead is not stamped with.
    expect(resolvePermitTrade({ normalized_trade: 42 }, "roofing")).toBeNull();
  });
});

describe("resolveTerritoryHolder", () => {
  const roofer: TerritoryHolder = { id: "c-roof", trade: "roofing" };
  const plumber: TerritoryHolder = { id: "a-plumb", trade: "plumbing" };
  const gc: TerritoryHolder = { id: "b-gc", trade: "general" };

  it("routes a permit to the holder who claimed the ZIP for that trade", () => {
    // The defect this replaces: with a roofer and a plumber in one ZIP, the
    // old `counter % contractors.length` handed the roofing permit to
    // whichever the counter landed on. Post-00135 they are necessarily
    // different trades, so that rotation was guaranteed misrouting.
    expect(resolveTerritoryHolder([plumber, roofer], "roofing")).toBe(roofer);
    expect(resolveTerritoryHolder([plumber, roofer], "plumbing")).toBe(plumber);
  });

  it("prefers the exact trade over the ZIP's general holder", () => {
    expect(resolveTerritoryHolder([gc, roofer], "roofing")).toBe(roofer);
  });

  it("falls back to the general holder when no one holds the permit's trade", () => {
    expect(resolveTerritoryHolder([gc, plumber], "roofing")).toBe(gc);
  });

  it("gives an unclassifiable permit to the ZIP's holder rather than dropping it", () => {
    // 90% of leads.trade values are the buckets other/residential/commercial/
    // general, which mean "the ingest could not classify this permit", not
    // "this job is not yours" (GENERIC_TRADE_BUCKETS, trade-gating.ts).
    // Dropping them would leave a single-trade holder with almost nothing in
    // a ZIP they paid for.
    expect(resolveTerritoryHolder([roofer], "residential")).toBe(roofer);
    expect(resolveTerritoryHolder([roofer], "other")).toBe(roofer);
    expect(resolveTerritoryHolder([roofer], null)).toBe(roofer);
  });

  it("drops a specific-trade permit no one in the ZIP holds", () => {
    // A roofing permit must not be handed to the plumber who happens to hold
    // the ZIP. The caller counts this as permits_dropped_trade_mismatch.
    expect(resolveTerritoryHolder([plumber], "roofing")).toBeNull();
    expect(resolveTerritoryHolder([plumber, roofer], "hvac")).toBeNull();
  });

  it("returns null when the ZIP has no holders at all", () => {
    expect(resolveTerritoryHolder(undefined, "roofing")).toBeNull();
    expect(resolveTerritoryHolder([], "roofing")).toBeNull();
  });

  it("is order-independent — PostgREST returns territory rows unordered", () => {
    expect(resolveTerritoryHolder([roofer, plumber, gc], "roofing")).toBe(roofer);
    expect(resolveTerritoryHolder([gc, plumber, roofer], "roofing")).toBe(roofer);
    expect(resolveTerritoryHolder([plumber, gc, roofer], "roofing")).toBe(roofer);
  });

  it("is deterministic across runs, so a re-score never inserts a second lead", () => {
    // onConflict is (permit_id, contractor_id): a re-score that picked a
    // DIFFERENT contractor would INSERT rather than UPDATE, producing two
    // leads for one permit — what territory-backfill exists to prevent.
    const holders = [roofer, plumber];
    const first = resolveTerritoryHolder(holders, "residential");
    const shuffled = [plumber, roofer];
    const second = resolveTerritoryHolder(shuffled, "residential");
    expect(first).toBe(second);
    // Lowest contractor_id wins, whatever order the rows arrived in.
    expect(first).toBe(plumber);
  });

  it("a duplicate (zip, trade) pair still resolves deterministically", () => {
    // 00135's unique index makes this unreachable; picking the minimum id
    // means a future index change cannot make the choice run-dependent.
    const dupA: TerritoryHolder = { id: "zzz", trade: "roofing" };
    const dupB: TerritoryHolder = { id: "aaa", trade: "roofing" };
    expect(resolveTerritoryHolder([dupA, dupB], "roofing")).toBe(dupB);
    expect(resolveTerritoryHolder([dupB, dupA], "roofing")).toBe(dupB);
  });

  it("today's live shape — one general holder per ZIP — is unchanged", () => {
    // All 10 active territories are held by one contractor at trade
    // 'general', so this fix must be a no-op against production data.
    const solo: TerritoryHolder = { id: "dev-contractor", trade: "general" };
    for (const trade of ["residential", "other", "roofing", "renovation", null]) {
      expect(resolveTerritoryHolder([solo], trade)).toBe(solo);
    }
  });
});
