/* ── Structured Logger ──────────────────────────────────────────────────────
 * JSON output in production, pretty output in development.
 * Drop-in replacement for console.error / console.log in cron routes
 * and webhook handlers.
 * ────────────────────────────────────────────────────────────────────────── */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== "production";

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
