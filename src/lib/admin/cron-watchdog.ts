/**
 * Cron-scheduler watchdog.
 *
 * Henri's data crons run under TWO schedulers:
 *   - 2 jobs scheduled natively in vercel.json (Hobby-plan cron limit).
 *   - ~19 jobs fired by an EXTERNAL scheduler that hits the Vercel HTTPS
 *     endpoints with a CRON_SECRET bearer.
 *
 * On ~2026-05-13/14 the external scheduler stopped firing and nothing
 * noticed for ~14 days, because the failure was silent: a scheduler that
 * never CALLS an endpoint writes no `cron_runs` row, logs no error, and
 * trips no alert. The data-health page showed the staleness, but staleness
 * with no push notification is invisible to a solo operator.
 *
 * This watchdog closes that gap. It runs from inside the still-alive
 * vercel.json-native weekly cron and asks one question: has ANY
 * externally-scheduled cron run recently? Because the whole external fleet
 * shares one scheduler, "the entire fleet has gone quiet" is the only
 * signal needed — and it never false-positives on an individually paused
 * cron. When the fleet is silent, surface it loudly via logger.error
 * (-> Sentry, which is live) plus a best-effort operator email.
 *
 * Best-effort throughout: never throws, so it can't break its host cron.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/** The 2 crons scheduled natively in vercel.json — excluded from the
 *  external-fleet health check (they ride Vercel's scheduler, not the
 *  external one, so they stay alive even when the external one dies). */
const NATIVE_CRON_PATHS = new Set<string>([
  "api/cron/refresh-zip-aggregates",
  "api/cron/synthesize-pre-intent",
]);

/** If no externally-scheduled cron has run in this many hours, the
 *  external scheduler is considered down. 48h tolerates a daily-cron
 *  hiccup or a single missed day without crying wolf. */
const STALE_HOURS = 48;

export interface CronWatchdogResult {
  /** True when the external scheduler appears to be down. */
  stale: boolean;
  /** ISO timestamp of the most recent externally-scheduled cron run,
   *  or null when no external run exists in the sampled window. */
  lastExternalRunAt: string | null;
  /** Path of that most-recent external run (for the alert body). */
  lastExternalCron: string | null;
  /** Hours since that run, rounded to 1dp; null when no external run. */
  hoursSinceLastRun: number | null;
  /** ISO timestamp of when this check ran. */
  checkedAt: string;
}

/**
 * Check external-scheduler health and alert if the fleet has gone quiet.
 * Returns a summary the host cron can stamp into its response / cron_runs.
 * Never throws.
 */
export async function runCronWatchdog(): Promise<CronWatchdogResult> {
  const checkedAt = new Date().toISOString();
  const result: CronWatchdogResult = {
    stale: false,
    lastExternalRunAt: null,
    lastExternalCron: null,
    hoursSinceLastRun: null,
    checkedAt,
  };

  try {
    const supabase = createAdminClient();
    // Pull the most-recent runs and filter the native paths out in JS —
    // cheaper than a PostgREST not-in list and robust to path formatting.
    const { data, error } = await supabase
      .from("cron_runs")
      .select("cron_path, started_at")
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) {
      logger.warn("cron-watchdog.query_failed", { error: error.message });
      return result;
    }

    const newestExternal = (data ?? []).find(
      (row) => !NATIVE_CRON_PATHS.has(row.cron_path),
    );

    if (newestExternal?.started_at) {
      result.lastExternalRunAt = newestExternal.started_at;
      result.lastExternalCron = newestExternal.cron_path;
      const ageMs = Date.now() - Date.parse(newestExternal.started_at);
      result.hoursSinceLastRun =
        Math.round((ageMs / 3_600_000) * 10) / 10;
      result.stale = ageMs > STALE_HOURS * 3_600_000;
    } else {
      // No external run at all in the last 50 cron_runs rows — treat as
      // stale (either the fleet never ran or it's been quiet a long time).
      result.stale = true;
    }

    if (result.stale) {
      logger.error("cron-watchdog.external_scheduler_stale", {
        lastExternalRunAt: result.lastExternalRunAt,
        lastExternalCron: result.lastExternalCron,
        hoursSinceLastRun: result.hoursSinceLastRun,
        staleThresholdHours: STALE_HOURS,
        hint:
          "External scheduler appears down — no externally-scheduled cron " +
          "has fired recently. Check the external scheduler is running and " +
          "its CRON_SECRET matches Vercel, then re-fire via the data-health " +
          "admin trigger.",
      });
      await emailOperator(result);
    } else {
      logger.info("cron-watchdog.ok", {
        lastExternalRunAt: result.lastExternalRunAt,
        hoursSinceLastRun: result.hoursSinceLastRun,
      });
    }
  } catch (err) {
    logger.warn("cron-watchdog.unexpected_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

/** Best-effort operator email via Resend. Skipped (and logged) when
 *  RESEND_API_KEY or a recipient address is missing. Never throws. */
async function emailOperator(result: CronWatchdogResult): Promise<void> {
  const recipient =
    process.env.FEEDBACK_INBOX ??
    process.env.GOD_MODE_EMAILS?.split(",")[0]?.trim();

  if (!process.env.RESEND_API_KEY || !recipient) {
    logger.info("cron-watchdog.email_skipped", {
      hasResend: !!process.env.RESEND_API_KEY,
      hasRecipient: !!recipient,
    });
    return;
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "alerts@meethenri.com";
    const last = result.lastExternalRunAt
      ? `${result.lastExternalRunAt} (${result.hoursSinceLastRun}h ago, ${result.lastExternalCron})`
      : "no external cron run found in recent history";

    await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: "Henri. — external cron scheduler appears DOWN",
      text:
        `The data-cron watchdog detected that no externally-scheduled cron ` +
        `has run in over ${STALE_HOURS}h.\n\n` +
        `Most recent external run: ${last}\n` +
        `Checked at: ${result.checkedAt}\n\n` +
        `Likely causes:\n` +
        ` 1. The external scheduler (the host that fires the Vercel cron ` +
        `endpoints) is down or its crontab was cleared.\n` +
        ` 2. CRON_SECRET was rotated in Vercel but not in the scheduler ` +
        `config (would show as 401s in Vercel logs).\n\n` +
        `Fix: confirm the scheduler is running + its CRON_SECRET matches ` +
        `Vercel, then re-fire the backlog via the data-health admin trigger.\n\n` +
        `— Henri. cron watchdog`,
    });
    logger.info("cron-watchdog.email_sent", { recipient });
  } catch (err) {
    logger.warn("cron-watchdog.email_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
