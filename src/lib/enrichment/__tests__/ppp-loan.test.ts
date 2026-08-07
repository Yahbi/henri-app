/**
 * Tests for the `ppp_loans` availability memo in
 * `src/lib/enrichment/ppp-loan.ts`.
 *
 * Why this matters: `ppp_loans` exists but holds 0 rows on this deployment
 * (the ingest script has never been run). The enrich cron's telemetry across
 * 31 runs recorded 16,704 `ppp_sba` calls with 0 hits at ~146 ms each, and the
 * pass is SEQUENTIAL in the orchestrator, so every lead paid that latency for
 * a table that could not answer. The cron is deadline-bound at 280 s and only
 * completes 38-56% of its batch, so this came straight out of throughput.
 *
 * The memo must (a) stop the per-lead lookups while the table is empty,
 * (b) not be permanent — an empty table is an operational state, not a fact
 * about the world — and (c) keep the module's never-throw contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  rows: unknown[] | null;
  error: { message?: string } | null;
  selects: string[];
} = { rows: [], error: null, selects: [] };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const builder = {
      select: (cols: string) => {
        state.selects.push(cols);
        return builder;
      },
      ilike: () => builder,
      eq: () => builder,
      limit: async () => ({ data: state.rows, error: state.error }),
    };
    return { from: () => builder };
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { lookupPPP, __resetPPPAvailability } from "../ppp-loan";

const ARGS = { businessName: "Acme Plumbing LLC", address: "1 Main St", zip: "90210", stateCode: "CA" };

beforeEach(() => {
  __resetPPPAvailability();
  state.rows = [];
  state.error = null;
  state.selects = [];
});

describe("ppp-loan availability memo", () => {
  it("issues exactly ONE probe and no lookups when the table is empty", async () => {
    state.rows = [];
    const hit = await lookupPPP(ARGS);
    expect(hit).toBeNull();
    // Probe only: a lookup would have selected the full SELECT_COLS list.
    expect(state.selects).toEqual(["borrower_name"]);
  });

  it("memoizes, so later leads in the same run make no query at all", async () => {
    state.rows = [];
    await lookupPPP(ARGS);
    const probesAfterFirst = state.selects.length;
    await lookupPPP({ ...ARGS, businessName: "Other Co" });
    await lookupPPP({ ...ARGS, businessName: "Third Co" });
    expect(state.selects.length).toBe(probesAfterFirst);
  });

  it("treats a missing table as unavailable without throwing", async () => {
    state.rows = null;
    state.error = { message: 'relation "public.ppp_loans" does not exist' };
    await expect(lookupPPP(ARGS)).resolves.toBeNull();
  });

  it("proceeds to the real lookup once the table has rows", async () => {
    state.rows = [
      {
        borrower_name: "Acme Plumbing LLC",
        borrower_address: "1 Main St",
        borrower_city: "Beverly Hills",
        borrower_state: "CA",
        borrower_zip: "90210",
        naics_code: "238220",
        owner_first: "Jane",
        owner_last: "Doe",
        business_phone: "310-555-0100",
        employee_count: 4,
        loan_amount: 21000,
      },
    ];
    const hit = await lookupPPP(ARGS);
    expect(hit).not.toBeNull();
    expect(hit!.owner_name).toBe("Jane Doe");
    expect(hit!.business_phone).toBe("310-555-0100");
    expect(hit!.source).toBe("ppp_sba");
    // Probe first, then the real column list.
    expect(state.selects[0]).toBe("borrower_name");
    expect(state.selects.length).toBeGreaterThan(1);
    expect(state.selects[1]).toContain("business_phone");
  });

  it("still short-circuits on unusable input before probing", async () => {
    await expect(lookupPPP({})).resolves.toBeNull();
    expect(state.selects).toEqual([]);
  });
});
