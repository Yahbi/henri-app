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
 * WHAT GETS COUNTED
 * `permits` is not purely permits. Mis-mapped auto-discovered endpoints
 * put business licences, building footprints and sewer records into the
 * same table, and counting those in a public "1.4M+ permits" claim is
 * the kind of inflation CLAUDE.md forbids. `permit_sources.dataset_kind`
 * carries the registry's classification, so this route subtracts one
 * index-only `count(*) WHERE source_city = $1` per explicitly-non-permit
 * feed. That fan-out is why the correction lives here and not in the
 * read path: it costs one extra query per junk source, and this route
 * has a 60s budget where a marketing page render has six seconds.
 *
 * FAILURE POSTURE
 * Partial failure never corrupts the cache, and the cache is never
 * published from an incomplete read. A histogram missing California
 * would silently under-report coverage on the homepage, so the rule is
 * that a stale-but-correct row beats a fresh-but-wrong one.
 *
 * How that rule is applied changed on 2026-08-06, after both of this
 * route's live failure modes turned out to abort the whole refresh:
 *
 *   - A per-state count that still errors after MAX_ATTEMPTS now CARRIES
 *     FORWARD that state's previous cached figures instead of aborting.
 *     The observed failure was `state AL: unknown` — the empty-message
 *     error the pool returns under worker contention, which is transient
 *     by nature. Carrying the last known value keeps the state on the map
 *     (the exact thing the abort existed to protect) and the run is
 *     recorded as `partial` naming every state carried. If a state has no
 *     previous value there is nothing to carry, and the refresh aborts as
 *     before.
 *
 *   - The subtraction-budget ceiling now DEGRADES rather than throwing.
 *     Exceeding it means we cannot subtract every non-permit feed, and a
 *     partial subtraction over-states the catalog — the one direction
 *     CLAUDE.md forbids — so the cache is deliberately left untouched.
 *     That is not an error in this route, so it is logged `partial` with
 *     the count and answered 200 rather than failing the scheduler run
 *     every hour over a registry-classification fact.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/admin/cron-log";
import { ALL_US_STATES, deriveActiveStates } from "@/lib/stats/us-states";
import { fetchNonPermitSources, countLeadsExact, type NonPermitSource } from "@/lib/stats/landing";

export const dynamic = "force-dynamic";
/**
 * 300s, raised from 60s on 2026-08-06.
 *
 * The subtraction fan-out is one count query per non-permit feed and the
 * registry now classifies 479 of them, which no longer fits a 60s budget
 * with any headroom. 300 is the ceiling the rest of the cron fleet uses and
 * matches the scheduler's `curl --max-time 290`. The run still guards itself
 * with SUBTRACTION_DEADLINE_MS below rather than relying on this ceiling.
 */
export const maxDuration = 300;

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

/**
 * Ceiling on how many non-permit feeds we will subtract in one run.
 *
 * Each one costs a count query, so an unbounded list would blow
 * `maxDuration`. The old value was 120 against a 60s budget; the registry
 * now classifies 479 feeds as non-permit, so every run since has refused to
 * publish and the cache has been frozen. At the measured ~90ms per
 * index-only count with CONCURRENCY 4, 1,000 feeds is ~23s of wall time —
 * comfortable inside the 300s budget — and SUBTRACTION_DEADLINE_MS stops the
 * run anyway if the instance is slower than that on the day.
 *
 * Crossing 1,000 still means the registry classified far more feeds as junk
 * than anyone expects, which is a signal to look rather than to publish.
 */
const MAX_EXCLUDED_SOURCES = 1000;

/**
 * Wall-clock ceiling on the subtraction fan-out.
 *
 * The count is bounded above, but per-count LATENCY is not — the instance
 * has had days where an index-only count took seconds. Without this, a slow
 * day runs past `maxDuration`, Vercel kills the function mid-flight, and the
 * run leaves no `cron_runs` row at all: indistinguishable from never having
 * fired. Hitting it degrades (cache untouched, run logged `partial`).
 */
const SUBTRACTION_DEADLINE_MS = 240_000;

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

  /**
   * Stop without publishing, without erroring the run.
   *
   * Used for the conditions where the read is INCOMPLETE — a subtraction we
   * cannot finish, a state we cannot count and cannot carry. Publishing from
   * an incomplete read would over-state the catalog, and erroring would put a
   * red run in front of the operator every hour for something that is not a
   * fault in this route. The cache keeps its last good row either way; the
   * reason lands in `cron_runs` as `partial`.
   */
  const degrade = async (reason: string): Promise<NextResponse> => {
    logger.warn("refresh-landing-stats.degraded", { reason });
    await logCronRun("refresh-landing-stats", startedAt, {
      status: "partial",
      error: reason,
    });
    return NextResponse.json({ ok: false, degraded: reason });
  };

  try {
    // Previous cache row, read ONCE up front.
    //
    // It is the fallback for a state whose count will not come back (see the
    // carry-forward below) and for the ZIP total, and reading it here rather
    // than lazily means the fallback is available at the moment it is needed
    // instead of after the run has already decided to abort.
    const { data: prevRow } = await supabase
      .from("landing_stats")
      .select("value")
      .eq("key", "coverage")
      .maybeSingle();
    const prevValue = (prevRow?.value ?? null) as {
      state_permits?: Record<string, number>;
      state_permits_zipped?: Record<string, number>;
      zips_covered?: unknown;
    } | null;

    /** States whose figures came from the previous cache, not this run. */
    const carriedStates: string[] = [];

    // 51 index-only counts, plus the leads total, the distinct-ZIP helper
    // RPC, and the registry reads that drive the non-permit subtraction.
    // Each is its own statement, so each gets its own 8s budget rather
    // than sharing one.
    const [stateCounts, leadsRes, zipsRes, nonPermitSources, sourceTotalRes] =
      await Promise.all([
        mapWithConcurrency(ALL_US_STATES, CONCURRENCY, async (state) => {
          let lastError = "";
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const total = await supabase
              .from("permits")
              .select("*", { count: "exact", head: true })
              .eq("state", state);
            // SECOND figure: rows that carry a ZIP.
            //
            // The raw count above is NOT a measure of what a contractor can
            // buy. Territories are sold per ZIP and lead creation opens with
            // an `if (!zip) continue` guard, so a permit with no ZIP can
            // never enter anyone's territory. On 2026-08-05 that is 63.9% of
            // the catalog (869,599 of 2,436,095 rows carry a ZIP), and the
            // gap is not spread evenly — 10 of the 34 states the raw
            // threshold certified as "covered" held under 500 ZIP-bearing
            // rows. The marketing map was promising coverage that could not
            // be sold. See `deriveActiveStates` for how the two are used.
            //
            // Sequential rather than Promise.all: each count is a PARALLEL
            // index-only scan that claims a worker of its own, and the
            // CONCURRENCY cap above is set at 4 precisely because the pool
            // saturated at 12. Firing both at once would put 8 scans in
            // flight and walk straight back toward that. Two ~89ms
            // statements in series cost ~180ms; a saturated pool costs the
            // whole refresh.
            const zipped = total.error
              ? null
              : await supabase
                  .from("permits")
                  .select("*", { count: "exact", head: true })
                  .eq("state", state)
                  .not("zip", "is", null);
            const error = total.error ?? zipped?.error ?? null;
            if (!error) return [state, total.count ?? 0, zipped?.count ?? 0] as const;
            // Transient pool/worker contention surfaces here as an error
            // with an EMPTY message, so include the code to keep the
            // final failure diagnosable.
            lastError = error.message || error.code || "unknown";
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, 250 * attempt));
            }
          }
          // Retries exhausted. Observed live as `state AL: unknown` — the
          // empty-message error the connection pool returns under worker
          // contention, which clears on its own. Aborting the entire refresh
          // over one flaky state is what kept the whole cache stale, so
          // carry that state's last published figures forward instead. The
          // run is marked `partial` and names the state, so a state that
          // carries forward run after run is visible rather than silent.
          const prevTotal = prevValue?.state_permits?.[state];
          const prevZipped = prevValue?.state_permits_zipped?.[state];
          if (typeof prevTotal === "number") {
            carriedStates.push(state);
            return [
              state,
              prevTotal,
              typeof prevZipped === "number" ? prevZipped : 0,
            ] as const;
          }
          // Nothing to carry — publishing would drop the state off the map
          // entirely, which is the under-report the abort exists to prevent.
          throw new Error(`state ${state}: ${lastError}`);
        }),
        // EXACT, summed over the urgency enum.
        //
        // This was a "planned" count, justified as accurate to ~5% and "a
        // marketing stat, not an invoice". Measured 2026-08-05, the planner
        // said 295,327 against a true 274,783 — it OVERSTATED by 20,544
        // (+7.5%). The project's truthfulness rule requires figures to round
        // DOWN, so an estimate that overshoots is not a rounding choice, it
        // is a published number we cannot defend. Being a marketing stat is
        // the reason it has to be right, not a reason it can be loose.
        //
        // An unfiltered exact count really does take 8.8s and trip the 8s
        // statement_timeout, so the count is split across `urgency`, which
        // is a 4-value enum backed by idx_leads_urgency. Each bucket is an
        // Index Only Scan with Heap Fetches 0 — measured 57ms — so every
        // statement sits far under the ceiling and the sum is exact.
        // Verified: 237,290 cool + 20,543 warm + 16,950 cold = 274,783.
        //
        // The NULL bucket is counted too. Leaving it out would silently
        // undercount the day someone adds a code path that inserts a lead
        // before urgency is assigned.
        countLeadsExact(supabase),
        supabase.rpc("count_distinct_permit_zips"),
        // Empty list when `dataset_kind` hasn't shipped yet — the refresh
        // then behaves exactly as it did before, per the feature-flag rule.
        fetchNonPermitSources(supabase),
        supabase
          .from("permit_sources")
          .select("*", { count: "exact", head: true }),
      ]);

    if (leadsRes.error) throw new Error(`leads: ${leadsRes.error.message}`);

    // Vocabulary guard. `fetchNonPermitSources` assumes the registry spells
    // a genuine permit feed 'permit'. If that value ever drifts, EVERY
    // source reads as non-permit and the subtraction below would erase the
    // catalog. Refuse to publish rather than zero the homepage.
    const totalSources = sourceTotalRes.count ?? 0;
    if (totalSources > 0 && nonPermitSources.length * 2 > totalSources) {
      throw new Error(
        `${nonPermitSources.length} of ${totalSources} permit_sources classified non-permit — refusing to publish (dataset_kind vocabulary drift?)`,
      );
    }
    if (nonPermitSources.length > MAX_EXCLUDED_SOURCES) {
      // Not an error in this route — the registry simply classified more
      // feeds as junk than we can subtract in one budget. Subtracting only
      // some of them would over-state the catalog, so leave the cache alone
      // and say why.
      return await degrade(
        `${nonPermitSources.length} non-permit sources exceeds the ${MAX_EXCLUDED_SOURCES} subtraction budget — cache left untouched rather than publishing a partially corrected count`,
      );
    }

    // One index-only `count(*) WHERE source_city = $1` per junk feed. The
    // unique index on (source_city, source_id) covers it, so this is the
    // same shape and cost as the per-state counts above.
    //
    // `null` means "this feed's rows could not be counted" — retries
    // exhausted, or the wall-clock budget ran out. Either way the total
    // below would silently keep those rows in it, so the run degrades
    // instead of publishing.
    const deadline = startedAt + SUBTRACTION_DEADLINE_MS;
    const excludedCounts = await mapWithConcurrency(
      nonPermitSources,
      CONCURRENCY,
      async (src: NonPermitSource) => {
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (Date.now() > deadline) return null;
          const { count, error } = await supabase
            .from("permits")
            .select("*", { count: "exact", head: true })
            .eq("source_city", src.sourceCity);
          if (!error) return [src, count ?? 0] as const;
          lastError = error.message || error.code || "unknown";
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 250 * attempt));
          }
        }
        logger.warn("refresh-landing-stats.excluded-count-failed", {
          source: src.sourceCity,
          error: lastError,
        });
        return null;
      },
    );

    const uncounted = excludedCounts.filter((r) => r === null).length;
    if (uncounted > 0) {
      return await degrade(
        `${uncounted} of ${nonPermitSources.length} non-permit feeds could not be counted (retries exhausted or ${SUBTRACTION_DEADLINE_MS}ms subtraction budget hit) — cache left untouched`,
      );
    }

    const statePermits: Record<string, number> = {};
    // Parallel histogram counting only rows that carry a ZIP — the subset
    // that can actually reach a territory and become a lead.
    const statePermitsZipped: Record<string, number> = {};
    for (const [state, n, zipped] of stateCounts) {
      if (n > 0) statePermits[state] = n;
      if (zipped > 0) statePermitsZipped[state] = zipped;
    }

    // Attribute each junk feed's rows to the state the registry declares
    // for it and subtract. Two deliberate imprecisions, both biased toward
    // under-claiming, which is the side CLAUDE.md requires:
    //   - a feed's rows can derive a state other than its declared one, so
    //     subtracting the whole count from the declared bucket can remove
    //     more than that state actually holds. Clamped at 0.
    //   - a feed with no usable declared state ('US' / blank) can't be
    //     attributed at all, so its rows come off the TOTAL only. The
    //     per-state histogram then slightly overstates those states while
    //     the headline stays honest.
    let excludedRows = 0;
    let excludedUnattributed = 0;
    // Every entry is non-null here — the `uncounted > 0` guard above
    // returned early otherwise.
    for (const entry of excludedCounts) {
      if (entry === null) continue;
      const [src, n] = entry;
      if (n <= 0) continue;
      excludedRows += n;
      const st = src.declaredState;
      if (st && statePermits[st] != null) {
        statePermits[st] = Math.max(0, statePermits[st] - n);
        // The ZIP-bearing histogram gets the SAME subtraction. We only
        // counted the junk feed's rows in total, not split by ZIP, and
        // measuring that split would cost a second query per excluded
        // source. Taking the whole figure off can over-subtract (a junk
        // feed's rows are at most as many as its ZIP-bearing rows), which
        // is the same imprecision the line above already accepts and it
        // errs the same way: toward claiming LESS coverage than we hold,
        // which is the side CLAUDE.md requires. Clamped at 0.
        if (statePermitsZipped[st] != null) {
          statePermitsZipped[st] = Math.max(0, statePermitsZipped[st] - n);
        }
      } else {
        excludedUnattributed += n;
      }
    }
    for (const [st, n] of Object.entries(statePermits)) {
      if (n <= 0) delete statePermits[st];
    }
    for (const [st, n] of Object.entries(statePermitsZipped)) {
      if (n <= 0) delete statePermitsZipped[st];
    }

    const permitsTotal = Math.max(
      0,
      Object.values(statePermits).reduce((a, b) => a + b, 0) -
        excludedUnattributed,
    );

    // Sanity gate before we overwrite a known-good row. The catalog is
    // well past 1M; anything smaller means a broken read (or a runaway
    // subtraction), not a small database, and must not reach the homepage.
    if (permitsTotal < 1_000_000 || Object.keys(statePermits).length < 10) {
      throw new Error(
        `implausible aggregate (permits=${permitsTotal}, states=${Object.keys(statePermits).length}, excluded=${excludedRows}) — refusing to overwrite cache`,
      );
    }

    // The ZIP count is the one nice-to-have: if the RPC is missing or
    // slow, keep the previous value rather than failing the refresh or
    // zeroing a stat that's rendered on the homepage.
    let zipsCovered = typeof zipsRes.data === "number" ? zipsRes.data : 0;
    if (zipsRes.error || zipsCovered <= 0) {
      // Reuses the cache row already read at the top of the run rather than
      // issuing a second identical select.
      const prevZips = prevValue?.zips_covered;
      zipsCovered = typeof prevZips === "number" ? prevZips : 0;
      logger.warn("refresh-landing-stats.zip-count-unavailable", {
        error: zipsRes.error?.message,
        carriedForward: zipsCovered,
      });
    }

    // `excluded_*` are observability only — the read path ignores unknown
    // keys. They exist so an operator can tell a shrinking headline caused
    // by a newly-classified junk feed apart from one caused by data loss.
    // `state_permits_zipped` is written ALONGSIDE `state_permits`, never
    // instead of it: the raw histogram still drives the map's volume
    // shading and per-state tooltips (those really are permit counts),
    // while the ZIP-bearing one answers the different question of which
    // states hold anything sellable. Emitted only when non-empty, so an
    // all-zero result is indistinguishable from a row written before this
    // key existed and readers degrade to raw volume either way rather
    // than concluding coverage collapsed to nothing.
    const payload = {
      permits_total: permitsTotal,
      leads_total: leadsRes.count ?? 0,
      zips_covered: zipsCovered,
      state_permits: statePermits,
      ...(Object.keys(statePermitsZipped).length > 0
        ? { state_permits_zipped: statePermitsZipped }
        : {}),
      excluded_sources: nonPermitSources.length,
      excluded_rows: excludedRows,
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
      // The number the marketing map is allowed to claim, computed through
      // the same helper the read path uses so the cron log and the homepage
      // can never disagree about what "covered" means. Logged next to the
      // raw `states` count deliberately: the gap between the two IS the
      // finding, and an operator watching it shrink is watching geocoding
      // backfill turn unsellable rows into sellable territory.
      states_covered: deriveActiveStates(statePermits, statePermitsZipped)
        .length,
      excluded_sources: nonPermitSources.length,
      excluded_rows: excludedRows,
      // States whose figures are the PREVIOUS run's, because their count
      // would not come back this time. Named, not just counted, so a state
      // that carries forward repeatedly is visible.
      carried_forward_states: carriedStates,
      duration_ms: durationMs,
    };

    await logCronRun("refresh-landing-stats", startedAt, {
      // A row that carries any state forward is fresh in most of its figures
      // and stale in one — neither `ok` nor `error`.
      status: carriedStates.length > 0 ? "partial" : "ok",
      pulled: permitsTotal,
      inserted: 1,
      summary,
      error:
        carriedStates.length > 0
          ? `carried forward previous counts for: ${carriedStates.join(", ")}`
          : null,
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("refresh-landing-stats.failed", { error: message });
    await logCronRun("refresh-landing-stats", startedAt, {
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
