/**
 * Tests for `src/lib/territory/ziplock.ts`.
 *
 * Both behaviours under test were shipped broken and stayed invisible
 * because the failing path was unreachable in production:
 *
 *   getZipAvailability — called the RPC with only `p_zip`, so `p_trade`
 *     bound to its DEFAULT NULL and `available_for_trade` came back null on
 *     every call. The onboarding picker fell back to `slots_used <
 *     slots_total`, which under migration 00135's per-(zip, trade) model
 *     answers a different question: a ZIP with one of ten trade slots taken
 *     reads "available" even when the taken one is the caller's. The claim
 *     then failed with `zip_taken_for_trade` AFTER checkout.
 *
 *   joinWaitlist — inserted a `created_at` column zip_waitlist does not
 *     have and omitted `position`, which is NOT NULL with no default. Every
 *     call failed. Nobody noticed because the button is only offered for a
 *     ZIP the picker calls taken, and the trade-blind check above never
 *     called one taken.
 *
 * Fixing the first makes the second routine, so both are pinned here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type QueryError = { message: string; code?: string; details?: string | null };
type QueryResult = { data: unknown; error: QueryError | null };

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  /** FIFO queues consumed by the mock builder, one entry per expected call. */
  tailResults: [] as QueryResult[],
  insertResults: [] as QueryResult[],
  /** Everything handed to `.insert()`, for payload assertions. */
  insertPayloads: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => {
  /** Minimal chainable stand-in for a PostgREST query builder. Real
   *  builders are single-use and thenable; the mock matches that shape so
   *  the tests exercise the same call pattern production uses. */
  function builder() {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async (): Promise<QueryResult> =>
        mocks.tailResults.shift() ?? { data: null, error: null },
      insert: (payload: Record<string, unknown>): Promise<QueryResult> => {
        mocks.insertPayloads.push(payload);
        return Promise.resolve(mocks.insertResults.shift() ?? { data: null, error: null });
      },
    };
    return b;
  }
  return {
    createAdminClient: () => ({ rpc: mocks.rpc, from: () => builder() }),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getZipAvailability, joinWaitlist } from "../ziplock";

const CONTRACTOR = "11111111-1111-1111-1111-111111111111";

/** A well-formed get_zip_availability payload (migration 00137). */
function payload(over: Record<string, unknown> = {}) {
  return {
    zip: "33607",
    slots_used: 1,
    slots_total: 10,
    taken_trades: ["roofing"],
    available_for_trade: null,
    contractors: [],
    waitlist_count: 0,
    ...over,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.tailResults.length = 0;
  mocks.insertResults.length = 0;
  mocks.insertPayloads.length = 0;
});

describe("getZipAvailability", () => {
  it("forwards the caller's trade as p_trade", async () => {
    mocks.rpc.mockResolvedValue({ data: payload({ available_for_trade: false }), error: null });

    await getZipAvailability("33607", "roofing");

    expect(mocks.rpc).toHaveBeenCalledWith("get_zip_availability", {
      p_zip: "33607",
      p_trade: "roofing",
    });
  });

  it("binds p_trade to null when no trade is supplied", async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });

    await getZipAvailability("33607");

    expect(mocks.rpc).toHaveBeenCalledWith("get_zip_availability", {
      p_zip: "33607",
      p_trade: null,
    });
  });

  it("refuses a label outside trade_type rather than passing it to Postgres", async () => {
    // p_trade is typed public.trade_type — an unknown label is a cast error
    // (500), not a null result.
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });

    await getZipAvailability("33607", "roofing; drop table" as never);

    expect(mocks.rpc).toHaveBeenCalledWith("get_zip_availability", {
      p_zip: "33607",
      p_trade: null,
    });
  });

  it("returns the per-trade verdict and the taken trades", async () => {
    mocks.rpc.mockResolvedValue({
      data: payload({ slots_used: 2, taken_trades: ["roofing", "hvac"], available_for_trade: false }),
      error: null,
    });

    const result = await getZipAvailability("33607", "roofing");

    expect(result?.available_for_trade).toBe(false);
    expect(result?.taken_trades).toEqual(["roofing", "hvac"]);
    // Slot counts survive for the trade-blind caller.
    expect(result?.slots_used).toBe(2);
    expect(result?.slots_total).toBe(10);
  });

  it("keeps a missing available_for_trade as null, never as true", async () => {
    // An older get_zip_availability that predates 00137 omits the key. The
    // UI treats null as "unknown"; coercing it to a boolean here would put
    // a green check on a ZIP we know nothing about.
    const { available_for_trade: _omitted, ...withoutKey } = payload();
    mocks.rpc.mockResolvedValue({ data: withoutKey, error: null });

    const result = await getZipAvailability("33607", "roofing");

    expect(result?.available_for_trade).toBeNull();
  });

  it("drops non-string entries from taken_trades instead of rendering them", async () => {
    mocks.rpc.mockResolvedValue({
      data: payload({ taken_trades: ["roofing", null, 7] }),
      error: null,
    });

    const result = await getZipAvailability("33607", "roofing");

    expect(result?.taken_trades).toEqual(["roofing"]);
  });

  it("returns null on an unexpected payload shape", async () => {
    mocks.rpc.mockResolvedValue({ data: { is_claimed: false }, error: null });

    expect(await getZipAvailability("33607", "roofing")).toBeNull();
  });

  it("returns null when the RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await getZipAvailability("33607", "roofing")).toBeNull();
  });
});

describe("joinWaitlist", () => {
  it("allocates position 1 on an empty waitlist", async () => {
    mocks.tailResults.push({ data: null, error: null });
    mocks.insertResults.push({ data: null, error: null });

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(true);
    expect(mocks.insertPayloads[0]).toEqual({
      zip: "33607",
      contractor_id: CONTRACTOR,
      position: 1,
    });
  });

  it("allocates the next position after the current tail", async () => {
    mocks.tailResults.push({ data: { position: 4 }, error: null });
    mocks.insertResults.push({ data: null, error: null });

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(true);
    expect(mocks.insertPayloads[0].position).toBe(5);
  });

  it("never writes created_at — the column does not exist", async () => {
    // This is the whole bug: PostgREST rejected the insert with PGRST204
    // before Postgres could complain about the missing NOT NULL position.
    mocks.tailResults.push({ data: null, error: null });
    mocks.insertResults.push({ data: null, error: null });

    await joinWaitlist("33607", CONTRACTOR);

    expect(mocks.insertPayloads[0]).not.toHaveProperty("created_at");
  });

  it("leaves joined_at to the column default", async () => {
    mocks.tailResults.push({ data: null, error: null });
    mocks.insertResults.push({ data: null, error: null });

    await joinWaitlist("33607", CONTRACTOR);

    expect(mocks.insertPayloads[0]).not.toHaveProperty("joined_at");
  });

  it("reports an existing entry as a friendly duplicate", async () => {
    mocks.tailResults.push({ data: { position: 2 }, error: null });
    mocks.insertResults.push({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_zip_waitlist_contractor"',
        details: "Key (zip, contractor_id)=(33607, ...) already exists.",
      },
    });

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Already on the waitlist for this ZIP");
    // One attempt only — a duplicate contractor is terminal, not a race.
    expect(mocks.insertPayloads).toHaveLength(1);
  });

  it("retries past a position taken by a concurrent joiner", async () => {
    mocks.tailResults.push({ data: { position: 2 }, error: null });
    mocks.insertResults.push({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_zip_waitlist_position"',
        details: "Key (zip, position)=(33607, 3) already exists.",
      },
    });
    mocks.tailResults.push({ data: { position: 3 }, error: null });
    mocks.insertResults.push({ data: null, error: null });

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(true);
    expect(mocks.insertPayloads.map((p) => p.position)).toEqual([3, 5]);
  });

  it("surfaces a non-duplicate failure instead of the friendly message", async () => {
    // The pre-fix code returned the friendly duplicate text for code 23505
    // only, but the real failure was PGRST204 and fell through to the raw
    // driver string. Either way a schema failure must never read as
    // "you're already on the list".
    mocks.tailResults.push({ data: null, error: null });
    mocks.insertResults.push({
      data: null,
      error: { code: "PGRST204", message: "Could not find the 'created_at' column" },
    });

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(false);
    expect(result.message).toContain("created_at");
  });

  it("gives up after exhausting the position retries", async () => {
    const collision = {
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_zip_waitlist_position"',
        details: null,
      },
    };
    for (let i = 0; i < 3; i++) {
      mocks.tailResults.push({ data: { position: 1 }, error: null });
      mocks.insertResults.push(collision);
    }

    const result = await joinWaitlist("33607", CONTRACTOR);

    expect(result.success).toBe(false);
    expect(mocks.insertPayloads).toHaveLength(3);
  });
});
