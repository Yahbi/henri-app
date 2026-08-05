/**
 * GET /api/cron/cron-runs-cleanup
 *
 * Daily housekeeping — deletes `cron_runs` audit rows older than 30
 * days. Without this the table grows unbounded (~17 crons × multiple
 * runs/day = thousands of rows/year). 30 days is enough to spot
 * patterns + investigate recent failures; older rows just bloat the
 * table.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Captured AFTER the auth check on purpose: an unauthorized request is
  // not a run, and logging it would reset catchup's staleness clock for
  // this cron without any work having happened.
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();

  try {
    // Delete with returning=count via head:true on the count meta.
    const { error, count } = await supabase
      .from("cron_runs")
      .delete({ count: "exact" })
      .lt("started_at", cutoff);

    if (error) {
      logger.warn("cron-runs-cleanup.delete_failed", { error: error.message });
      await logCronRun("cron-runs-cleanup", startedAt, {
        status: "error",
        error: error.message,
        trigger: detectTrigger(request),
      });
      return NextResponse.json(
        { error: "delete failed", detail: error.message },
        { status: 500 },
      );
    }

    logger.info("cron-runs-cleanup.done", {
      duration_ms: Date.now() - startedAt,
      deleted: count ?? 0,
      retention_days: RETENTION_DAYS,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      deleted: count ?? 0,
      retention_days: RETENTION_DAYS,
      cutoff,
    };
    // This route deletes rows; it neither pulls upstream nor inserts. Both
    // counters are omitted rather than repurposed — the delete count lives
    // in `summary.deleted`. (The audit row is written after the DELETE, so
    // it can never delete its own log entry.)
    await logCronRun("cron-runs-cleanup", startedAt, {
      summary: result,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("cron-runs-cleanup.error", { error: String(err) });
    await logCronRun("cron-runs-cleanup", startedAt, {
      status: "error",
      error: String(err),
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "cron-runs-cleanup failed", detail: String(err) },
      { status: 500 },
    );
  }
}
