/* ── Structured Logger ──────────────────────────────────────────────────────
 * JSON output in production, pretty output in development.
 * Drop-in replacement for console.error / console.log in cron routes
 * and webhook handlers.
 *
 * ## Error-tracking integration (Phase 5 launch hardening)
 *
 * The `logger.error(...)` path forwards to an optional external sink when
 * `SENTRY_DSN` (or any other error-tracker env var) is set AND an adapter
 * has been registered via `registerErrorSink()`. The default adapter is a
 * no-op so installing @sentry/nextjs is a one-line init without touching
 * every logger call site.
 *
 * Wiring Sentry (or any alternative):
 *
 *   1. `pnpm add @sentry/nextjs`  (or `@datadog/browser-logs`, etc.)
 *   2. In `instrumentation.ts` at the repo root, register the sink:
 *        import * as Sentry from "@sentry/nextjs";
 *        Sentry.init({ dsn: process.env.SENTRY_DSN });
 *        registerErrorSink((msg, meta) => {
 *          Sentry.captureException(new Error(msg), { extra: meta });
 *        });
 *   3. Deploy — `logger.error(...)` now reports to Sentry while still
 *      printing the structured JSON line for Vercel log ingestion.
 *
 * The sink is fire-and-forget — we never await it. If the tracker is
 * down, the local log still lands, and the cron doesn't wait on a flaky
 * network call. See the `safeCall` wrapper below for the exact semantics.
 * ────────────────────────────────────────────────────────────────────────── */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== "production";

/* ── Error-tracker adapter hook ───────────────────────────────────────── */

type ErrorSink = (message: string, meta?: Record<string, unknown>) => void;

/** Default no-op sink. The operator overrides via registerErrorSink(). */
let errorSink: ErrorSink = () => {};

/**
 * Register a function that receives every `logger.error(...)` call. Used
 * by the Sentry (or other tracker) init code in `instrumentation.ts`.
 * Calling this multiple times replaces the previous sink — there's no
 * fan-out today because one tracker is enough.
 */
export function registerErrorSink(sink: ErrorSink): void {
  errorSink = sink;
}

/** Call the sink in a try/catch — never let a broken tracker break the
 *  request that's being logged. */
function safeCall(message: string, meta?: Record<string, unknown>): void {
  try {
    errorSink(message, meta);
  } catch (sinkErr) {
    // Only log the sink's own failure to console — don't recurse into
    // logger.error, which would trip the sink again.
    console.warn("[logger] error-sink threw:", sinkErr);
  }
}

function formatEntry(entry: LogEntry): string {
  if (isDev) {
    const { level, message, timestamp, ...rest } = entry;
    const extras =
      Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    return `[${timestamp}] ${level.toUpperCase()} ${message}${extras}`;
  }
  return JSON.stringify(entry);
}

function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const formatted = formatEntry(entry);

  switch (level) {
    case "error":
      console.error(formatted);
      // Forward to the registered error tracker (Sentry etc.) — no-op
      // unless registerErrorSink() has been called. Errors in the sink
      // itself never propagate to the caller. See module-level doc.
      safeCall(message, meta);
      break;
    case "warn":
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    log("error", message, meta),
};
