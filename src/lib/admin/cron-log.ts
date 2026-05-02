/**
 * Per-execution audit log for sidecar-data cron routes.
 *
 * `logCronRun()` writes one row to `public.cron_runs` (migration 00076)
 * capturing the full lifecycle of a cron invocation — start time,
 * finish time, duration, ok/error status, pulled / inserted counts,
 * and the route's response payload for forensic replay.
 *
 * Why a sidecar table when we already have `logger.info` lines?
 *   - Vercel logs roll over — anything older than ~24h is gone.
 *   - The data-health UI can render this audit table in seconds.
 *   - Silent failures (cron fires, errors, returns 200 with 0 inserts)
 *     show up as `status='error'` rows here even if the table itself
 *     looks "stale but populated".
 *
 * The helper is best-effort: if the cron_runs table doesn't exist yet
 * (migration 00076 not applied) or the insert errors, we swallow the
 * failure and let the cron continue. Audit logging never blocks a
 * data-acquisition run.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface CronRunSummary {
  /** Pulled = rows fetched upstream (could be 0 even on success). */
  pulled?: number | null;
  /** Inserted = rows actually upserted into our DB. */
  inserted?: number | null;
  /** Free-form payload — typically the route's response.json. */
  summary?: unknown;
  /** Error message if the run failed. Truncated to 2KB. */
  error?: string | null;
  /** 'cron' (Vercel scheduled) | 'manual' (admin-trigger button). */
  trigger?: "cron" | "manual";
  /** Override status. Default: 'ok' if no error, 'error' if error. */
  status?: "ok" | "error" | "partial";
}

const ERROR_MAX_BYTES = 2048;

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

/**
 * Log a cron run. Returns void — fire-and-forget audit, never throws.
 *
 * Pass startedAt + Date.now() for accurate timing; the helper computes
 * duration_ms internally.
 */
export async function logCronRun(
  cronPath: string,
  startedAt: number,
  payload: CronRunSummary,
): Promise<void> {
  try {
    const finishedAt = Date.now();
    const status =
      payload.status ?? (payload.error ? "error" : "ok");
    const supabase = createAdminClient();
    const { error } = await supabase.from("cron_runs").insert({
      cron_path: cronPath,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - startedAt,
      status,
      pulled: payload.pulled ?? null,
      inserted: payload.inserted ?? null,
      summary: payload.summary ?? null,
      error: truncate(payload.error, ERROR_MAX_BYTES),
      trigger: payload.trigger ?? "cron",
    });
    if (error) {
      // Common cause: migration 00076 not yet applied. Don't crash
      // the cron — log the audit-failure once and move on.
      logger.warn("cron-log.insert_failed", {
        cron: cronPath,
        error: error.message,
      });
    }
  } catch (e) {
    logger.warn("cron-log.unexpected_error", {
      cron: cronPath,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Wrap a cron route's main work in a try/catch + audit log.
 *
 * Usage in a route handler:
 *
 *   const startedAt = Date.now();
 *   try {
 *     // ... do the work ...
 *     await logCronRun("swdi-events", startedAt, {
 *       pulled, inserted, summary: result, trigger,
 *     });
 *     return NextResponse.json(result);
 *   } catch (err) {
 *     await logCronRun("swdi-events", startedAt, {
 *       error: String(err), trigger,
 *     });
 *     throw err;
 *   }
 *
 * Helper kept lightweight intentionally — every route already has
 * its own response-shape (NextResponse.json) so a high-level wrapper
 * would either lose type info or force every route into a generic
 * shape. Calling the helper directly is two lines per route.
 */

/**
 * Detect whether a cron run was triggered manually via the admin UI.
 * The admin-trigger route forwards the request with a custom
 * `x-cron-trigger: manual` header so the cron can record which path
 * the invocation came in on.
 */
export function detectTrigger(request: Request): "cron" | "manual" {
  const h = request.headers.get("x-cron-trigger");
  return h === "manual" ? "manual" : "cron";
}
