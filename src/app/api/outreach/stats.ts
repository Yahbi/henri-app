/**
 * Outreach stat math — extracted from `route.ts` so it can be unit-tested
 * without standing up a Supabase client.
 *
 * 2026-08-06 truthfulness pass. Two defects lived in the inlined version:
 *
 *  1. The rates were computed as `Math.round((opened / sent) * 100) / 100`,
 *     which rounds a FRACTION to two decimals instead of converting it to a
 *     percentage. The Outreach card renders `${open_rate.toFixed(1)}%`, so
 *     5 opens out of 10 sends displayed as "0.5%" — a hundredfold
 *     understatement of the contractor's own performance. Latent until the
 *     Resend/Twilio webhooks are provisioned (nothing writes `opened_at` /
 *     `replied_at` before then), which is exactly why it had to be fixed
 *     before launch rather than after someone acted on it.
 *
 *  2. The counts were tallied over the 50-row page the table renders, so
 *     "Messages Sent" saturated at 50 no matter how much had really been
 *     sent. That half is fixed in `route.ts` with head-only COUNT queries;
 *     this module owns the arithmetic.
 */

/**
 * Queue statuses that mean the message actually left Henri.
 *
 * `queued` and `failed` are deliberately absent — a queued row has not been
 * sent, and a failed row never reached the recipient. Counting either would
 * inflate the denominator and depress every rate.
 */
export const SENT_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "replied",
] as const;

export type SentStatus = (typeof SENT_STATUSES)[number];

/**
 * A percentage (0–100) with one decimal place, matching the `toFixed(1)`
 * the Outreach card applies.
 *
 * Rounds DOWN (CLAUDE.md: never round up). A reply rate of 1/3 reports as
 * 33.3%, never 33.4% — the contractor's own numbers should never read
 * better than they are.
 *
 * Returns 0 for an empty or non-finite denominator: with nothing sent there
 * is no rate to state, and the Outreach page already renders an explicit
 * "stats will populate after your first outbound message" note for that
 * case, so 0 is not being passed off as a measured result.
 *
 * The numerator is capped at the denominator. `opened_at` can only be
 * stamped on a row that was sent, so >100% would mean a webhook raced the
 * send-status write — an anomaly worth logging but never worth rendering as
 * a "140% open rate".
 */
export function computeRatePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0 || numerator <= 0) return 0;
  const capped = Math.min(numerator, denominator);
  return Math.floor((capped / denominator) * 1000) / 10;
}
