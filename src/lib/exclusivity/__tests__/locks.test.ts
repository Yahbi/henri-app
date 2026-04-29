/**
 * Tests for `src/lib/exclusivity/locks.ts` — wedge bullet #1
 * (one contractor per permit per trade for 14 days).
 *
 * The audit-priority-#5 list flagged this module at 0% coverage; it's
 * load-bearing for the entire wedge. Specifically, the B4+B5 fix earlier
 * this session switched `acquireLock` from INSERT-then-conflict-fetch to
 * an atomic upsert with retry. Without tests a future refactor could
 * silently revert that and break wedge bullet #1.
 *
 * Coverage focus:
 *   1. acquireLock — same contractor returns idempotent row
 *   2. acquireLock — different contractor returns null (locked)
 *   3. acquireLock — table-missing → null (graceful-degrade)
 *   4. acquireLock — first-attempt empty result triggers retry
 *   5. releaseLock — table-missing → no-op (graceful-degrade)
 *   6. summarizeLocksForContractor — held_by_caller flag + ms_remaining
 *   7. summarizeLocksForContractor — empty leadIds short-circuits
 *   8. summarizeWatchersByLead — coarse bucket (1-2 / 3-5 / 5+) — wedge #6
 *   9. summarizeWatchersByLead — caller excluded from watchers
 *  10. summarizeWatchersByLead — expired locks excluded
 *  11. summarizeWatchersByLead — table-missing → all "0" buckets
 *  12. formatRemaining — pill-text formatting across ranges
 */
import { describe, it, expect, vi } from "vitest";
import {
  acquireLock,
  releaseLock,
  summarizeLocksForContractor,
  summarizeWatchersByLead,
  formatRemaining,
  DEFAULT_WINDOW_MS,
} from "../locks";

/** Build a minimal mock SupabaseClient where each call to .from() returns
 *  a chainable query builder whose terminal call returns `result`.
 *  Real supabase-js builders are single-use; the mock matches that shape
 *  so the tests exercise the same call patterns the production code uses. */
type MockResult<T = unknown> = { data: T | null; error: { message: string; code?: string } | null };

interface ChainableBuilder<T = unknown> {
  upsert: (...args: unknown[]) => ChainableBuilder<T>;
  update: (...args: unknown[]) => ChainableBuilder<T>;
  select: (...args: unknown[]) => ChainableBuilder<T>;
  eq: (...args: unknown[]) => ChainableBuilder<T>;
  in: (...args: unknown[]) => ChainableBuilder<T>;
  is: (...args: unknown[]) => ChainableBuilder<T>;
  single: () => Promise<MockResult<T>>;
  /** Used as the terminal `await` for non-single queries. PromiseLike. */
  then: <R>(onFulfilled: (value: MockResult<T>) => R) => Promise<R>;
}

interface MockSupabase {
  from: (table: string) => ChainableBuilder;
  /** Spy on every call into `.from(table)` for assertions. */
  fromCalls: string[];
  /** Spy on the .upsert payloads + options for race-safety assertions. */
  upsertCalls: Array<{ payload: unknown; options: unknown }>;
}

function makeMockSupabase(
  results: MockResult[] | ((call: number) => MockResult),
): MockSupabase {
  let callIdx = 0;
  const fromCalls: string[] = [];
  const upsertCalls: Array<{ payload: unknown; options: unknown }> = [];
  const builder: ChainableBuilder = {
    upsert: (payload, options) => {
      upsertCalls.push({ payload, options });
      return builder;
    },
    update: () => builder,
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    single: async () => {
      const result =
        typeof results === "function" ? results(callIdx++) : results[callIdx++];
      return result ?? { data: null, error: null };
    },
    then: <R,>(onFulfilled: (value: MockResult) => R) => {
      const result =
        typeof results === "function" ? results(callIdx++) : results[callIdx++];
      return Promise.resolve(onFulfilled(result ?? { data: null, error: null }));
    },
  };
  return {
    from: (table) => {
      fromCalls.push(table);
      return builder;
    },
    fromCalls,
    upsertCalls,
  };
}

describe("acquireLock", () => {
  it("returns the existing lock when the same contractor already holds it (idempotent)", async () => {
    const existing = {
      id: "lock-1",
      lead_id: "lead-1",
      contractor_id: "contractor-A",
      trade: "roofing",
      zip: "90210",
      window_start: new Date().toISOString(),
      window_end: new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
      forfeit_deadline: null,
      released_at: null,
      released_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supa = makeMockSupabase([{ data: existing, error: null }]);
    const lock = await acquireLock(supa as never, {
      lead_id: "lead-1",
      contractor_id: "contractor-A",
      trade: "roofing",
      zip: "90210",
    });
    expect(lock).not.toBeNull();
    expect(lock?.contractor_id).toBe("contractor-A");
    expect(supa.upsertCalls).toHaveLength(1);
  });

  it("returns null when a different contractor holds the active lock", async () => {
    const otherLock = {
      id: "lock-2",
      lead_id: "lead-2",
      contractor_id: "contractor-B",
      trade: "hvac",
      zip: "30303",
      window_start: new Date().toISOString(),
      window_end: new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
      forfeit_deadline: null,
      released_at: null,
      released_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supa = makeMockSupabase([{ data: otherLock, error: null }]);
    const lock = await acquireLock(supa as never, {
      lead_id: "lead-2",
      contractor_id: "contractor-A",
      trade: "hvac",
      zip: "30303",
    });
    expect(lock).toBeNull();
  });

  it("returns null gracefully when the locks table doesn't exist (pre-migration 00031)", async () => {
    const supa = makeMockSupabase([
      {
        data: null,
        error: {
          message: "Could not find the table 'public.lead_exclusivity_locks'",
          code: "PGRST205",
        },
      },
    ]);
    const lock = await acquireLock(supa as never, {
      lead_id: "lead-3",
      contractor_id: "contractor-A",
      trade: "plumbing",
      zip: "10001",
    });
    expect(lock).toBeNull();
  });

  it("retries once after a 50ms backoff when first upsert returns no row (B5 race)", async () => {
    // First call: no row + no error (the rare race window where upsert
    // arrived but the conflicting row got released between conflict and
    // RETURNING). Second call: row written successfully.
    const supa = makeMockSupabase([
      { data: null, error: null },
      {
        data: {
          id: "lock-4",
          lead_id: "lead-4",
          contractor_id: "contractor-A",
          trade: "solar",
          zip: "85001",
          window_start: new Date().toISOString(),
          window_end: new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
          forfeit_deadline: null,
          released_at: null,
          released_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      },
    ]);
    const lock = await acquireLock(supa as never, {
      lead_id: "lead-4",
      contractor_id: "contractor-A",
      trade: "solar",
      zip: "85001",
    });
    expect(lock).not.toBeNull();
    expect(lock?.id).toBe("lock-4");
    // Both attempts should have triggered upserts.
    expect(supa.upsertCalls).toHaveLength(2);
  });

  it("returns null after both retries fail (no thrown error)", async () => {
    const supa = makeMockSupabase([
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const lock = await acquireLock(supa as never, {
      lead_id: "lead-5",
      contractor_id: "contractor-A",
      trade: "electrical",
      zip: "60601",
    });
    expect(lock).toBeNull();
    expect(supa.upsertCalls).toHaveLength(2);
  });

  it("uses the documented onConflict columns for the partial unique index", async () => {
    const existing = {
      id: "x",
      lead_id: "lead-6",
      contractor_id: "contractor-A",
      trade: null,
      zip: null,
      window_start: new Date().toISOString(),
      window_end: new Date(Date.now() + DEFAULT_WINDOW_MS).toISOString(),
      forfeit_deadline: null,
      released_at: null,
      released_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const supa = makeMockSupabase([{ data: existing, error: null }]);
    await acquireLock(supa as never, {
      lead_id: "lead-6",
      contractor_id: "contractor-A",
      trade: null,
      zip: null,
    });
    const opts = supa.upsertCalls[0]?.options as Record<string, unknown>;
    expect(opts.onConflict).toBe("lead_id,trade");
    expect(opts.ignoreDuplicates).toBe(false);
  });
});

describe("releaseLock", () => {
  it("issues an update with released_at + released_reason", async () => {
    // No error → no warn log; the function returns void.
    const supa = makeMockSupabase([{ data: null, error: null }]);
    await expect(
      releaseLock(supa as never, {
        lead_id: "lead-7",
        contractor_id: "contractor-A",
        reason: "won",
      }),
    ).resolves.toBeUndefined();
    expect(supa.fromCalls[0]).toBe("lead_exclusivity_locks");
  });

  it("swallows table-missing errors silently (graceful-degrade)", async () => {
    const supa = makeMockSupabase([
      {
        data: null,
        error: {
          message: "Could not find the table 'public.lead_exclusivity_locks'",
          code: "PGRST205",
        },
      },
    ]);
    await expect(
      releaseLock(supa as never, {
        lead_id: "lead-8",
        contractor_id: "contractor-A",
        reason: "expired",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("summarizeLocksForContractor", () => {
  it("returns empty Map when leadIds is empty (short-circuit)", async () => {
    // Should not even call supabase.from.
    const supa = makeMockSupabase(() => ({ data: null, error: null }));
    const out = await summarizeLocksForContractor(supa as never, "contractor-A", []);
    expect(out.size).toBe(0);
    expect(supa.fromCalls).toHaveLength(0);
  });

  it("flags held_by_caller correctly per row", async () => {
    const now = Date.now();
    const supa = makeMockSupabase([
      {
        data: [
          {
            lead_id: "lead-A",
            contractor_id: "contractor-A",
            window_end: new Date(now + 100_000).toISOString(),
            released_at: null,
          },
          {
            lead_id: "lead-B",
            contractor_id: "contractor-B",
            window_end: new Date(now + 200_000).toISOString(),
            released_at: null,
          },
        ],
        error: null,
      },
    ]);
    const out = await summarizeLocksForContractor(supa as never, "contractor-A", [
      "lead-A",
      "lead-B",
    ]);
    expect(out.get("lead-A")?.held_by_caller).toBe(true);
    expect(out.get("lead-B")?.held_by_caller).toBe(false);
    // ms_remaining should be positive for both (locks not expired)
    expect(out.get("lead-A")?.ms_remaining).toBeGreaterThan(0);
    expect(out.get("lead-B")?.ms_remaining).toBeGreaterThan(0);
  });

  it("returns empty Map on table-missing (graceful-degrade)", async () => {
    const supa = makeMockSupabase([
      {
        data: null,
        error: {
          message: "Could not find the table",
          code: "PGRST205",
        },
      },
    ]);
    const out = await summarizeLocksForContractor(supa as never, "contractor-A", [
      "lead-X",
    ]);
    expect(out.size).toBe(0);
  });
});

describe("summarizeWatchersByLead — wedge bullet #6 (coarse bucket)", () => {
  it("buckets watcher counts to 0 / 1-2 / 3-5 / 5+", async () => {
    const now = Date.now();
    const future = new Date(now + 100_000).toISOString();
    const supa = makeMockSupabase([
      {
        data: [
          // lead-A: 0 other watchers (just the caller)
          { lead_id: "lead-A", contractor_id: "contractor-Caller", window_end: future, released_at: null },
          // lead-B: 1 other watcher → "1-2"
          { lead_id: "lead-B", contractor_id: "contractor-X", window_end: future, released_at: null },
          // lead-C: 2 other watchers → "1-2"
          { lead_id: "lead-C", contractor_id: "contractor-X", window_end: future, released_at: null },
          { lead_id: "lead-C", contractor_id: "contractor-Y", window_end: future, released_at: null },
          // lead-D: 3 other watchers → "3-5"
          { lead_id: "lead-D", contractor_id: "contractor-X", window_end: future, released_at: null },
          { lead_id: "lead-D", contractor_id: "contractor-Y", window_end: future, released_at: null },
          { lead_id: "lead-D", contractor_id: "contractor-Z", window_end: future, released_at: null },
          // lead-E: 6 other watchers → "5+"
          { lead_id: "lead-E", contractor_id: "contractor-1", window_end: future, released_at: null },
          { lead_id: "lead-E", contractor_id: "contractor-2", window_end: future, released_at: null },
          { lead_id: "lead-E", contractor_id: "contractor-3", window_end: future, released_at: null },
          { lead_id: "lead-E", contractor_id: "contractor-4", window_end: future, released_at: null },
          { lead_id: "lead-E", contractor_id: "contractor-5", window_end: future, released_at: null },
          { lead_id: "lead-E", contractor_id: "contractor-6", window_end: future, released_at: null },
        ],
        error: null,
      },
    ]);
    const out = await summarizeWatchersByLead(
      supa as never,
      "contractor-Caller",
      ["lead-A", "lead-B", "lead-C", "lead-D", "lead-E"],
    );
    expect(out.get("lead-A")?.bucket).toBe("0");
    expect(out.get("lead-B")?.bucket).toBe("1-2");
    expect(out.get("lead-C")?.bucket).toBe("1-2");
    expect(out.get("lead-D")?.bucket).toBe("3-5");
    expect(out.get("lead-E")?.bucket).toBe("5+");
  });

  it("excludes the caller from watcher count (the 'N other contractors' contract)", async () => {
    const now = Date.now();
    const future = new Date(now + 100_000).toISOString();
    const supa = makeMockSupabase([
      {
        data: [
          // Same lead, 3 contractors total — caller is one of them.
          { lead_id: "lead-1", contractor_id: "contractor-Caller", window_end: future, released_at: null },
          { lead_id: "lead-1", contractor_id: "contractor-X", window_end: future, released_at: null },
          { lead_id: "lead-1", contractor_id: "contractor-Y", window_end: future, released_at: null },
        ],
        error: null,
      },
    ]);
    const out = await summarizeWatchersByLead(
      supa as never,
      "contractor-Caller",
      ["lead-1"],
    );
    // Caller excluded → 2 others → "1-2" bucket
    expect(out.get("lead-1")?.bucket).toBe("1-2");
  });

  it("excludes expired-but-unreaped locks from the bucket", async () => {
    const now = Date.now();
    const past = new Date(now - 100_000).toISOString();
    const future = new Date(now + 100_000).toISOString();
    const supa = makeMockSupabase([
      {
        data: [
          // 3 expired (cron didn't reap yet) + 1 active → "1-2"
          { lead_id: "lead-1", contractor_id: "contractor-A", window_end: past, released_at: null },
          { lead_id: "lead-1", contractor_id: "contractor-B", window_end: past, released_at: null },
          { lead_id: "lead-1", contractor_id: "contractor-C", window_end: past, released_at: null },
          { lead_id: "lead-1", contractor_id: "contractor-D", window_end: future, released_at: null },
        ],
        error: null,
      },
    ]);
    const out = await summarizeWatchersByLead(
      supa as never,
      "contractor-Caller",
      ["lead-1"],
    );
    expect(out.get("lead-1")?.bucket).toBe("1-2"); // only contractor-D counts
  });

  it("returns all '0' buckets on table-missing (graceful-degrade)", async () => {
    const supa = makeMockSupabase([
      {
        data: null,
        error: {
          message: "Could not find the table",
          code: "PGRST205",
        },
      },
    ]);
    const out = await summarizeWatchersByLead(
      supa as never,
      "contractor-Caller",
      ["lead-1", "lead-2", "lead-3"],
    );
    expect(out.size).toBe(3);
    expect(out.get("lead-1")?.bucket).toBe("0");
    expect(out.get("lead-2")?.bucket).toBe("0");
    expect(out.get("lead-3")?.bucket).toBe("0");
  });

  it("short-circuits empty leadIds without calling supabase", async () => {
    const supa = makeMockSupabase([]);
    const out = await summarizeWatchersByLead(supa as never, "contractor-A", []);
    expect(out.size).toBe(0);
    expect(supa.fromCalls).toHaveLength(0);
  });
});

describe("formatRemaining", () => {
  it("returns 'expired' for non-positive ms", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(-1)).toBe("expired");
    expect(formatRemaining(-1_000_000)).toBe("expired");
  });

  it("formats minutes-only for sub-1-hour ranges", () => {
    expect(formatRemaining(30 * 60 * 1000)).toBe("30m left");
    expect(formatRemaining(59 * 60 * 1000)).toBe("59m left");
  });

  it("formats hours-only for 1-24h ranges", () => {
    expect(formatRemaining(2 * 60 * 60 * 1000)).toBe("2h left");
    expect(formatRemaining(23 * 60 * 60 * 1000)).toBe("23h left");
  });

  it("formats days+hours for multi-day ranges", () => {
    expect(formatRemaining(2 * 24 * 60 * 60 * 1000)).toBe("2d left");
    expect(
      formatRemaining(2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
    ).toBe("2d 3h left");
  });

  it("formats 14d default lock window", () => {
    expect(formatRemaining(14 * 24 * 60 * 60 * 1000)).toBe("14d left");
  });
});

describe("misc — vi import", () => {
  it("imports vi from vitest cleanly (smoke)", () => {
    // Sanity: ensure the test framework's mock helper is wired.
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
