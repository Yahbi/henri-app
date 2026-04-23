/**
 * Shared formatting helpers — currency + dates.
 *
 * Phase 2.3 — before this module, the contractor dashboard mixed
 * `.toLocaleString()`, raw `"$" + n`, and `.toLocaleDateString("en-US",
 * {month:"short",day:"numeric",year:"numeric"})` across 16 tabs. Every
 * tab formatted things slightly differently, so the app looked
 * inconsistent even though the underlying data was fine.
 *
 * Rules:
 *   • Currency always formatted via `formatCurrency` (Intl, USD, no cents).
 *   • Recency cues ("created 3 days ago") → `formatRelativeDate`.
 *   • Deadlines (license expiry, trial end) → `formatAbsoluteDate`.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Full currency format: `$12,345`. Use for dashboard totals, revenue
 * numbers, deal values — anywhere the full number is more informative
 * than the compact one.
 *
 * For compact card values (`$12K`, `$1.2M`) use `formatCurrency` from
 * `@/types/lead` instead. We keep the two separate on purpose; they
 * serve different density requirements.
 */
export function formatCurrencyFull(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return USD.format(value);
}

/**
 * Human-friendly relative time for recency cues (created_at,
 * last_contacted, last_message). Uses Intl.RelativeTimeFormat so it
 * localises for free when we eventually add i18n.
 *
 * Falls back to `formatAbsoluteDate` for anything older than 90 days —
 * at that point "3 months ago" loses precision and an absolute date
 * is more useful.
 */
const RTF = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function formatRelativeDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  const absDays = Math.abs(diffMs) / (1000 * 60 * 60 * 24);

  if (absDays > 90) return formatAbsoluteDate(date);

  const thresholds: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ];
  for (const { unit, ms } of thresholds) {
    if (Math.abs(diffMs) >= ms) {
      return RTF.format(Math.round(diffMs / ms), unit);
    }
  }
  return RTF.format(0, "second");
}

/**
 * Absolute-date format for deadlines and audit lines — renders as
 * "Apr 21, 2026" (no time). For items with a specific time-of-day, use
 * `formatDateTime` instead.
 */
export function formatAbsoluteDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
