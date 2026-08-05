/**
 * Refreshes the `landing_stats` coverage cache (migration 00115).
 *
 * WHY THIS ROUTE EXISTS
 * The marketing map needs a per-state permit histogram. Doing that as
 * one `GROUP BY state` is a 9.6s index-only scan (37.5s before the
 * table was vacuumed) — over the `authenticator` role's 8s
 * statement_timeout, which every PostgREST call inherits. So the map
 * shipped for three months against a hand-curated array of 25 state
 * codes frozen on 2026-05-07, while the database had grown to 46.
 *
 * The fix is to fan the aggregate out instead of running it whole.
 * A single-state `count(*) WHERE state = $1` is an index-only scan
 * measured at 89ms, so 51 of them in parallel finish in ~1-2s and each
 * one is comfortably inside the 8s ceiling. Same numbers, no timeout,
 * no role-level statement_timeout change (which would have removed a
 * safety guard from every service-role query in the app).
 *
 * SCHEDULING
 * vercel.json is capped at 2 cron entries on the Hobby plan and both
 * slots are taken, so this route is driven by the external scheduler
 * alongside the rest of the fleet (see docs/cron-schedule.md). It is
 * also safe to hit manually — it is idempotent and read-only apart from
 * the single cache row it upserts.
 *
 * FAILURE POSTURE
 * Partial failure never corrupts the cache. If any per-state count
 * errors the whole refresh aborts and leaves the previous row intact,
 * because a histogram missing California would silently under-report
 * coverage on the homepage. A stale-but-correct row beats a fresh-but-
 * wrong one.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/admin/cron-log";
import { ALL_US_STATES } from "@/lib/stats/us-states";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cap on concurrent count queries.
 *
 * Each count is a PARALLEL index-only scan, so every in-flight query
 * claims a worker of its own. At 12 the pool saturated and states
 * started coming back with empty-message errors (observed on HI).
 * 4 keeps total wall time around 2s while leaving the planner room.
 */
const CONCURRENCY = 4;

/** Per-state retries before the whole refresh aborts. */
const MAX_ATTEMPTS = 3;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  // Fail CLOSED: an unset secret must never mean "allow". Matches the
  // posture of the other 42 cron routes.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  try {
    // 51 index-only counts, plus the leads total and the distinct-ZIP
    // helper RPC. Each is its own statement, so each gets its own 8s
    // budget rather than sharing one.
    const [stateCounts, leadsRes, zipsRes] = await Promise.all([
      mapWithConcurrency(ALL_US_STATES, CONCURRENCY, async (state) => {
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const { count, error } = await supabase
            .from("permits")
            .select("*", { count: "exact", head: true })
            .eq("state", state);
          if (!error) return [state, count ?? 0] as const;
          // Transient pool/worker contention surfaces here as an error
          // with an EMPTY message, so include the code to keep the
          // final failure diagnosable.
          lastError = error.message || error.code || "unknown";
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 250 * attempt));
          }
        }
        throw new Error(`state ${state}: ${lastError}`);
      }),
      // "planned", not "exact": an exact count over 273k leads is a full
      // scan that measured 8.8s and tripped the 8s statement_timeout,
      // while the planner estimate returns in 399ms and is accurate to
      // within ~5% after ANALYZE. This figure is a marketing stat, not
      // an invoice, and the legacy read path already used a planned
      // count for it.
      supabase.from("leads").select("*", { count: "planned", head: true }),
      supabase.rpc("count_distinct_permit_zips"),
    ]);

    if (leadsRes.error) throw new Error(`leads: ${leadsRes.error.message}`);

    const statePermits: Record<string, number> = {};
    let permitsTotal = 0;
    for (const [state, n] of stateCounts) {
      if (n > 0) {
        statePermits[state] = n;
        permitsTotal += n;
      }
    }

    // Sanity gate before we overwrite a known-good row. The catalog is
    // well past 1M; anything smaller means a broken read, not a small
    // database, and must not reach the homepage.
    if (permitsTotal < 1_000_000 || Object.keys(statePermits).length < 10) {
      throw new Error(
        `implausible aggregate (permits=${permitsTotal}, states=${Object.keys(statePermits).length}) — refusing to overwrite cache`,
      );
    }

    // The ZIP count is the one nice-to-have: if the RPC is missing or
    // slow, keep the previous value rather than failing the refresh or
    // zeroing a stat that's rendered on the homepage.
    let zipsCovered = typeof zipsRes.data === "number" ? zipsRes.data : 0;
    if (zipsRes.error || zipsCovered <= 0) {
      const { data: prev } = await supabase
        .from("landing_stats")
        .select("value")
        .eq("key", "coverage")
        .maybeSingle();
      const prevZips = (prev?.value as { zips_covered?: unknown } | null)
        ?.zips_covered;
      zipsCovered = typeof prevZips === "number" ? prevZips : 0;
      logger.warn("refresh-landing-stats.zip-count-unavailable", {
        error: zipsRes.error?.message,
        carriedForward: zipsCovered,
      });
    }

    const payload = {
      permits_total: permitsTotal,
      leads_total: leadsRes.count ?? 0,
      zips_covered: zipsCovered,
      state_permits: statePermits,
      computed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("landing_stats")
      .upsert(
        { key: "coverage", value: payload, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (upsertError) throw new Error(`upsert: ${upsertError.message}`);

    const durationMs = Date.now() - startedAt;
    const summary = {
      permits: permitsTotal,
      leads: payload.leads_total,
      zips: zipsCovered,
      states: Object.keys(statePermits).length,
      duration_ms: durationMs,
    };

    await logCronRun("/api/cron/refresh-landing-stats", startedAt, {
      status: "ok",
      pulled: permitsTotal,
      inserted: 1,
      summary,
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("refresh-landing-stats.failed", { error: message });
    await logCronRun("/api/cron/refresh-landing-stats", startedAt, {
      status: "error",
      error: message,
    });
    // The previous cache row is untouched, so the homepage keeps
    // rendering the last good numbers.
    return NextResponse.json(
      { ok: false, error: "Refresh failed" },
      { status: 500 },
    );
  }
}
