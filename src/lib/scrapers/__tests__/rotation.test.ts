import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rotation + registry-classification tests for src/lib/scrapers/sources-db.ts.
 *
 * Three behaviours are load-bearing and were previously untested:
 *
 *   1. The 60/40 producer/explorer split — proven city feeds must not starve
 *      behind the ~12k never-produced discovery stubs.
 *   2. A source a probe classified `dataset_kind='non_permit'` must leave the
 *      rotation entirely, without consuming a slot a healthy source could use.
 *   3. Recording a FAILURE must never turn a source on. The previous form
 *      (`enabled: newCount < MAX_CONSECUTIVE_ERRORS`) wrote `true` for strikes
 *      1-9, so a failure against a deliberately-disabled source resurrected it.
 *
 * Plus the graceful-degrade path for migration 00122: every query that touches
 * `dataset_kind` must still work on a DB where the column does not exist.
 */

const h = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getActiveSources,
  recordSourceRun,
  activateProbedSources,
  rejectProbedSource,
  isUndefinedColumnError,
  datasetKindSupported,
  __resetDatasetKindSupport,
  MAX_CONSECUTIVE_ERRORS,
  PRODUCER_SHARE,
} from "../sources-db";

// ── minimal PostgREST-shaped fake ────────────────────────────────────────────

interface Filter {
  fn: string;
  args: unknown[];
}
interface QueryState {
  table: string;
  op: "select" | "update";
  filters: Filter[];
  payload?: Record<string, unknown>;
  limit?: number;
}
type Resolver = (q: QueryState) => {
  data: unknown;
  error: { code?: string; message: string } | null;
};

function createFakeClient(resolve: Resolver) {
  const calls: QueryState[] = [];

  function builder(state: QueryState) {
    const api: Record<string, unknown> = {};
    const chain =
      (fn: string) =>
      (...args: unknown[]) => {
        state.filters.push({ fn, args });
        return api;
      };
    for (const fn of ["eq", "neq", "gt", "lt", "or", "in", "not", "order"]) {
      api[fn] = chain(fn);
    }
    api.limit = (n: number) => {
      state.limit = n;
      return api;
    };
    api.maybeSingle = () => Promise.resolve(resolve(state));
    api.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(state)).then(ok, err);
    return api;
  }

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const state: QueryState = {
            table,
            op: "select",
            filters: [{ fn: "select", args: [columns] }],
          };
          calls.push(state);
          return builder(state);
        },
        update(payload: Record<string, unknown>) {
          const state: QueryState = { table, op: "update", filters: [], payload };
          calls.push(state);
          return builder(state);
        },
      };
    },
  };

  return { client, calls };
}

const has = (q: QueryState, fn: string, ...args: unknown[]) =>
  q.filters.some(
    (f) => f.fn === fn && args.every((a, i) => JSON.stringify(f.args[i]) === JSON.stringify(a)),
  );

const filtersNonPermit = (q: QueryState) => has(q, "neq", "dataset_kind", "non_permit");

/** Rows the fake DB holds. `enabled` is true for all — the lanes filter it. */
const ROWS = [
  { source_key: "producer-ok", last_count: 12, dataset_kind: "permit" },
  { source_key: "producer-licences", last_count: 9000, dataset_kind: "non_permit" },
  { source_key: "explorer-ok", last_count: 0, dataset_kind: "unknown" },
  { source_key: "explorer-wyes", last_count: null, dataset_kind: "non_permit" },
];

/** Answers the two lane queries the way Postgres would. */
const laneResolver: Resolver = (q) => {
  if (q.op !== "select") return { data: null, error: null };
  const producers = has(q, "gt", "last_count", 0);
  let rows = ROWS.filter((r) =>
    producers ? (r.last_count ?? 0) > 0 : !r.last_count,
  );
  if (filtersNonPermit(q)) rows = rows.filter((r) => r.dataset_kind !== "non_permit");
  return { data: rows.slice(0, q.limit ?? rows.length), error: null };
};

const UNDEFINED_COLUMN = {
  code: "42703",
  message: 'column permit_sources.dataset_kind does not exist',
};

beforeEach(() => {
  __resetDatasetKindSupport();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("isUndefinedColumnError", () => {
  it("recognises SQLSTATE 42703", () => {
    expect(isUndefinedColumnError(UNDEFINED_COLUMN)).toBe(true);
  });

  it("recognises the message form emitted by older PostgREST builds", () => {
    expect(
      isUndefinedColumnError({ message: 'column "dataset_kind" does not exist' }),
    ).toBe(true);
  });

  it("does not swallow unrelated errors — those must surface", () => {
    expect(isUndefinedColumnError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isUndefinedColumnError({ code: "57014", message: "statement timeout" })).toBe(false);
    expect(isUndefinedColumnError(null)).toBe(false);
    expect(isUndefinedColumnError(undefined)).toBe(false);
  });
});

describe("getActiveSources — probe-rejected sources leave the rotation", () => {
  it("drops dataset_kind='non_permit' from BOTH lanes without starving healthy sources", async () => {
    const fake = createFakeClient(laneResolver);
    h.client = fake.client;

    const sources = await getActiveSources(10);
    const keys = sources.map((s) => s.source_key);

    // The two mis-registered feeds are gone...
    expect(keys).not.toContain("producer-licences");
    expect(keys).not.toContain("explorer-wyes");
    // ...and their slots went to the healthy sources rather than being wasted.
    expect(keys).toEqual(["producer-ok", "explorer-ok"]);
  });

  it("still filters on enabled=true — a rejected source is disabled, not merely unclassified", async () => {
    const fake = createFakeClient(laneResolver);
    h.client = fake.client;
    await getActiveSources(10);

    const selects = fake.calls.filter((c) => c.op === "select");
    expect(selects).toHaveLength(2);
    for (const q of selects) {
      expect(has(q, "eq", "enabled", true)).toBe(true);
      expect(filtersNonPermit(q)).toBe(true);
    }
  });

  it("splits slots by PRODUCER_SHARE, explorers take the rest", async () => {
    // Both lanes answer with `limit` distinct rows, so the split is visible.
    const fake = createFakeClient((q) => ({
      data: Array.from({ length: q.limit ?? 0 }, (_, i) => ({
        source_key: `${has(q, "gt", "last_count", 0) ? "p" : "e"}${i}`,
      })),
      error: null,
    }));
    h.client = fake.client;

    const sources = await getActiveSources(50);
    expect(sources).toHaveLength(50);
    // Derived, not hardcoded: PRODUCER_SHARE is a tuning knob and this test
    // asserts the invariant it controls, not the value it happens to hold.
    const wantProducers = Math.ceil(50 * PRODUCER_SHARE);
    expect(sources.filter((s) => s.source_key.startsWith("p"))).toHaveLength(wantProducers);
    expect(sources.filter((s) => s.source_key.startsWith("e"))).toHaveLength(50 - wantProducers);
  });

  /**
   * The regression that mattered. The test above asserts the split across all
   * 50 returned sources — and it PASSED against the broken implementation,
   * because `[...producers, ...explorers]` does yield 30/20 once you read all
   * 50. The bug was that nothing reads all 50: /api/cron/scrape processes in
   * batches of 5 against a 175s budget and reaches roughly the first 15, where
   * the old order held 15 producers and 0 explorers.
   *
   * So the invariant worth testing is not the total — it is that EVERY prefix
   * is balanced, because the time budget truncates at an index the rotation
   * cannot predict.
   *
   * Live cost of getting this wrong, measured 2026-08-06: 210,903 of 239,897
   * enabled sources had never been scraped once, and exactly 44 had been
   * scraped in the previous 30 days.
   */
  it("keeps explorers in every prefix, because the time budget truncates the run", async () => {
    const fake = createFakeClient((q) => ({
      data: Array.from({ length: q.limit ?? 0 }, (_, i) => ({
        source_key: `${has(q, "gt", "last_count", 0) ? "p" : "e"}${i}`,
      })),
      error: null,
    }));
    h.client = fake.client;

    const sources = await getActiveSources(50);

    // 15 is what a 175s budget actually reaches; the others bracket it so the
    // property is tested rather than one magic number.
    for (const prefixLength of [5, 10, 15, 25, 50]) {
      const prefix = sources.slice(0, prefixLength);
      const explorers = prefix.filter((s) => s.source_key.startsWith("e")).length;
      const producers = prefix.length - explorers;

      expect(explorers).toBeGreaterThan(0);
      // Allow one slot of rounding drift either way.
      expect(producers).toBeGreaterThanOrEqual(Math.ceil(prefixLength * PRODUCER_SHARE) - 1);
      expect(producers).toBeLessThanOrEqual(Math.ceil(prefixLength * PRODUCER_SHARE) + 1);
    }
  });

  it("hands unused producer slots to explorers rather than shrinking the run", async () => {
    const fake = createFakeClient((q) =>
      has(q, "gt", "last_count", 0)
        ? { data: [{ source_key: "p0" }], error: null }
        : {
            data: Array.from({ length: q.limit ?? 0 }, (_, i) => ({ source_key: `e${i}` })),
            error: null,
          },
    );
    h.client = fake.client;

    const sources = await getActiveSources(10);
    expect(sources).toHaveLength(10);
    expect(sources[0].source_key).toBe("p0");
  });
});

describe("getActiveSources — graceful degrade before migration 00122", () => {
  it("retries without the dataset_kind filter when the column does not exist", async () => {
    const fake = createFakeClient((q) =>
      filtersNonPermit(q)
        ? { data: null, error: UNDEFINED_COLUMN }
        : { data: [{ source_key: `ok-${q.limit}` }], error: null },
    );
    h.client = fake.client;

    const sources = await getActiveSources(10);

    // 2 lanes x (1 failed attempt + 1 retry).
    expect(fake.calls.filter((c) => c.op === "select")).toHaveLength(4);
    expect(sources.length).toBeGreaterThan(0);
    expect(datasetKindSupported()).toBe(false);
  });

  it("remembers the column is missing so later runs cost no extra round trip", async () => {
    const fake = createFakeClient((q) =>
      filtersNonPermit(q)
        ? { data: null, error: UNDEFINED_COLUMN }
        : { data: [{ source_key: "ok" }], error: null },
    );
    h.client = fake.client;

    await getActiveSources(10);
    const afterFirst = fake.calls.length;
    await getActiveSources(10);

    // Second run: 2 queries, not 4 — and neither carries the filter.
    expect(fake.calls.length - afterFirst).toBe(2);
    expect(fake.calls.slice(afterFirst).some(filtersNonPermit)).toBe(false);
  });

  it("does NOT retry on an unrelated error — that would mask a real fault", async () => {
    const fake = createFakeClient(() => ({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    }));
    h.client = fake.client;

    const sources = await getActiveSources(10);
    expect(sources).toEqual([]);
    expect(fake.calls).toHaveLength(2);
    expect(datasetKindSupported()).toBeNull();
  });
});

describe("recordSourceRun — a failure must never enable a source", () => {
  function fakeWithErrorCount(errorCount: number) {
    const fake = createFakeClient((q) =>
      q.op === "select"
        ? { data: { error_count: errorCount, notes: null }, error: null }
        : { data: null, error: null },
    );
    h.client = fake.client;
    return fake;
  }

  it("leaves `enabled` untouched on strikes 1..9", async () => {
    const fake = fakeWithErrorCount(0);
    await recordSourceRun("probe-rejected-source", {
      outcome: "fetch_failed",
      rowCount: 0,
      detail: "activation probe failed",
    });

    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.payload?.error_count).toBe(1);
    // The bug: `enabled: newCount < MAX_CONSECUTIVE_ERRORS` wrote `true` here,
    // turning ON a source the operator (or the probe gate) had turned OFF.
    expect(update?.payload && "enabled" in update.payload).toBe(false);
  });

  it("disables at the strike limit", async () => {
    const fake = fakeWithErrorCount(MAX_CONSECUTIVE_ERRORS - 1);
    await recordSourceRun("dead-stub", { outcome: "upstream_error", rowCount: 0 });

    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.payload?.error_count).toBe(MAX_CONSECUTIVE_ERRORS);
    expect(update?.payload?.enabled).toBe(false);
  });

  it("stamps last_scraped_at on the failure path so the source rotates to the back", async () => {
    const fake = fakeWithErrorCount(2);
    await recordSourceRun("flaky", { outcome: "fetch_failed", rowCount: 0 });
    const update = fake.calls.find((c) => c.op === "update");
    expect(typeof update?.payload?.last_scraped_at).toBe("string");
  });
});

describe("activateProbedSources", () => {
  it("enables the passers and stamps the classification", async () => {
    const fake = createFakeClient(() => ({ data: null, error: null }));
    h.client = fake.client;

    const n = await activateProbedSources(["a", "b"]);

    expect(n).toBe(2);
    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.payload?.enabled).toBe(true);
    expect(update?.payload?.dataset_kind).toBe("permit");
    expect(has(update!, "in", "source_key", ["a", "b"])).toBe(true);
  });

  it("still enables when migration 00122 is absent", async () => {
    let attempts = 0;
    const fake = createFakeClient((q) => {
      if (q.op === "update" && q.payload && "dataset_kind" in q.payload) {
        attempts++;
        return { data: null, error: UNDEFINED_COLUMN };
      }
      return { data: null, error: null };
    });
    h.client = fake.client;

    expect(await activateProbedSources(["a"])).toBe(1);
    expect(attempts).toBe(1);
    const retry = fake.calls.filter((c) => c.op === "update").at(-1);
    expect(retry?.payload).toEqual({ enabled: true });
  });

  it("reports 0 — not a phantom activation — when the write fails", async () => {
    const fake = createFakeClient(() => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    }));
    h.client = fake.client;
    expect(await activateProbedSources(["a", "b"])).toBe(0);
  });

  it("is a no-op on an empty list", async () => {
    const fake = createFakeClient(() => ({ data: null, error: null }));
    h.client = fake.client;
    expect(await activateProbedSources([])).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("rejectProbedSource", () => {
  it("keeps the source disabled and records WHY in both places", async () => {
    const fake = createFakeClient(() => ({ data: null, error: null }));
    h.client = fake.client;

    await rejectProbedSource("elk-grove-business-licenses", {
      reason: "payload looks like a non-permit dataset (found 'license_number', ...)",
      observedKeys: ["LICENSE_NUMBER", "SITE_UNIT_NO"],
      notes: "Hand-added by founder 2026-05-01.",
    });

    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.payload?.enabled).toBe(false);
    expect(update?.payload?.dataset_kind).toBe("non_permit");
    expect(update?.payload?.dataset_kind_reason).toContain("license_number");

    const notes = String(update?.payload?.notes ?? "");
    // Operator prose survives, the machine block carries the evidence.
    expect(notes).toContain("Hand-added by founder 2026-05-01.");
    expect(notes).toContain("[henri:scrape-diagnostic]");
    expect(notes).toContain("outcome=unsupported");
    expect(notes).toContain("LICENSE_NUMBER");
  });

  it("still records the refusal in notes when migration 00122 is absent", async () => {
    const fake = createFakeClient((q) =>
      q.op === "update" && q.payload && "dataset_kind" in q.payload
        ? { data: null, error: UNDEFINED_COLUMN }
        : { data: null, error: null },
    );
    h.client = fake.client;

    await rejectProbedSource("wyes", { reason: "found 'wye_no'", observedKeys: ["WYE_NO"] });

    const retry = fake.calls.filter((c) => c.op === "update").at(-1);
    expect(retry?.payload?.enabled).toBe(false);
    expect(String(retry?.payload?.notes)).toContain("wye_no");
    expect(retry?.payload && "dataset_kind" in retry.payload).toBe(false);
  });
});
