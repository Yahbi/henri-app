import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import { runCronWatchdog } from "@/lib/admin/cron-watchdog";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Phase AA-3 — refresh `zip_pre_intent_aggregates`.
 *
 * Calls the SECURITY DEFINER function `refresh_zip_pre_intent_aggregates()`
 * (migration 00093) which truncates + recomputes the per-ZIP aggregate
 * counts over the last 730 days of permits. The recompute is the same
 * heavy aggregate that originally tripped the Mgmt API 8s timeout
 * during inline classification — caching it here lets the score cron
 * read O(1) per permit.
 *
 * Important: the function name in 00093 was named for the original
 * matview design (`REFRESH MATERIALIZED VIEW CONCURRENTLY ...`). After
 * the table-not-matview pivot the function may not exist OR may need
 * a different body. This route calls the function via PostgREST RPC
 * which gracefully degrades when the RPC is missing.
 *
 * Schedule (vercel.json): Sunday 03:00 UTC, weekly. Aligned to run
 * BEFORE the synthesize-pre-intent cron at Sunday 04:00 UTC so any
 * downstream consumers see fresh aggregates first.
 */

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  // Piggyback the external-scheduler watchdog on this alive vercel.json
  // cron. If the external cron fleet has gone silent, this surfaces it via
  // Sentry + operator email — the only thing that would have caught the
  // 2026-05 14-day silent outage. Independent of the refresh outcome.
  const watchdog = await runCronWatchdog();

  try {
    // Try the named function first.
    const { error: rpcErr } = await supabase.rpc("refresh_zip_pre_intent_aggregates");

    if (rpcErr) {
      // The function may not exist OR the matview-based function may
      // fail because we converted to a regular table. Fall back to a
      // direct SQL refresh via supabase-js's `from(…).select(0)` no-op
      // (PostgREST has no exec-arbitrary-SQL endpoint, so we surface
      // the original error and rely on the founder's manual populator
      // script `_populate-zip-aggregates-volume.mjs`).
      logger.warn("refresh-zip-aggregates.rpc_failed", {
        error: rpcErr.message,
        hint:
          "If `refresh_zip_pre_intent_aggregates()` fails because the matview was converted to a regular table, run `node scripts/_populate-zip-aggregates-volume.mjs` from the operator host instead.",
      });
      await logCronRun("api/cron/refresh-zip-aggregates", startedAt, {
        status: "error",
        trigger: detectTrigger(request),
        error: rpcErr.message,
      });
      return NextResponse.json(
        { error: "Refresh failed", detail: rpcErr.message, watchdog },
        { status: 500 },
      );
    }

    // Verify by reading row count post-refresh.
    const { count } = await supabase
      .from("zip_pre_intent_aggregates")
      .select("zip", { count: "exact", head: true });

    logger.info("refresh-zip-aggregates.ok", {
      row_count: count,
      duration_ms: Date.now() - startedAt,
    });

    await logCronRun("api/cron/refresh-zip-aggregates", startedAt, {
      status: "ok",
      trigger: detectTrigger(request),
      pulled: count ?? null,
      summary: { row_count: count },
    });

    return NextResponse.json({ success: true, row_count: count, watchdog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("refresh-zip-aggregates.fatal", { error: msg });
    await logCronRun("api/cron/refresh-zip-aggregates", startedAt, {
      status: "error",
      trigger: detectTrigger(request),
      error: msg,
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
