/**
 * Client-safe state constants and label formatters.
 *
 * Split out of `landing.ts` on 2026-08-04. `landing.ts` imports
 * `createAdminClient` (service-role Supabase), so any client component
 * that reached in for `ALL_US_STATES` or a formatter was pulling the
 * whole admin client into the browser bundle. The service-role key
 * itself never leaked — it isn't `NEXT_PUBLIC_`, so Next inlines it as
 * undefined client-side — but @supabase/supabase-js shipping to render
 * a static tile grid is pure waste.
 *
 * Nothing in this module touches the network, the database, or
 * `process.env`. `landing.ts` re-exports all of it, so existing
 * server-side imports keep working unchanged.
 */

export const ALL_US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

export type UsState = (typeof ALL_US_STATES)[number];

/**
 * Minimum ZIP-BEARING permits before a state counts as "covered" on the
 * marketing map.
 *
 * Live data has a long tail of states holding a literal handful of rows
 * (RI/VT/AR/ME each had exactly 1 permit on 2026-08-04) — almost always
 * a single mis-geocoded record, not coverage. Counting them would let
 * the headline claim 46 states when a contractor in Rhode Island would
 * find nothing.
 *
 * 2026-08-05 — the threshold now measures ZIP-BEARING rows, not raw ones.
 * Raw volume was the wrong basis: 63.9% of the catalog has no ZIP
 * (869,599 of 2,436,095 rows carry one), territories are sold per ZIP,
 * and lead creation opens with an `if (!zip) continue` guard. A permit
 * with no ZIP therefore cannot land in anyone's territory and cannot
 * become a lead. Measured on 2026-08-05, 10 of the 34 states this
 * threshold certified on raw volume held fewer than 500 ZIP-bearing
 * rows — the map was telling a contractor his state was covered when
 * nothing in it was purchasable.
 *
 * Tuning this only changes what we CLAIM, never what we store: every
 * state's true count still reaches the map, so the long tail renders as
 * a distinct "seeded" tier rather than disappearing.
 */
export const ACTIVE_STATE_MIN_PERMITS = 500;

/**
 * The states we are willing to call "covered", given the cached histograms.
 *
 * Single source of truth for that determination so the cron's operator
 * summary and the marketing read path cannot drift apart on what "covered"
 * means.
 *
 * `stateZipPermits` is OPTIONAL and the whole point of this signature.
 * The ZIP-bearing histogram only started being written on 2026-08-05, and
 * a `landing_stats` row persisted by the older cron carries just the raw
 * one. Rather than let those pages render an empty map, an absent (or
 * empty) ZIP histogram falls back to the raw counts — i.e. exactly the
 * behaviour this codebase had before, per the feature-flags-before-
 * migrations rule. The claim is only tightened once the data to tighten
 * it with actually exists.
 *
 * Candidate keys come from `statePermits` because it is the superset: a
 * state can hold permits with no ZIP at all, and such a state must be
 * considered-and-rejected rather than never considered.
 */
export function deriveActiveStates(
  statePermits: Readonly<Partial<Record<UsState, number>>>,
  stateZipPermits?: Readonly<Partial<Record<UsState, number>>>,
): UsState[] {
  const basis =
    stateZipPermits && Object.keys(stateZipPermits).length > 0
      ? stateZipPermits
      : statePermits;
  return (Object.keys(statePermits) as UsState[])
    .filter((s) => (basis[s] ?? 0) >= ACTIVE_STATE_MIN_PERMITS)
    .sort();
}

/**
 * Round a number DOWN to the nearest 100,000 and format as "1.4M+".
 * - 1,414,624 → "1.4M+"
 * - 1,499,999 → "1.4M+"
 * - 1,500,000 → "1.5M+"
 * - 999,999   → "0.9M+"
 * - 0         → "0.0M+"  (callers should fall back to a static label
 *                         for empty databases.)
 */
export function formatPermitsLabel(n: number): string {
  const tenths = Math.floor(n / 100_000); // e.g. 14 for 1.4M
  const millions = (tenths / 10).toFixed(1); // "1.4"
  return `${millions}M+`;
}

/**
 * The covered-state count, exact.
 *
 * - 34 → "34"
 * - 24 → "24"
 * -  0 → "0"   (callers already hide the stat on an empty database)
 *
 * 2026-08-05 — was `Math.floor(n / 5) * 5` rendered as "30+". Bucketing
 * made the figure unable to move: every count from 30 to 34 printed the
 * same "30+", so onboarding a whole new state changed nothing a visitor
 * could see, and the label read as a frozen marketing constant rather
 * than a live number — which is precisely what it used to be before the
 * `landing_stats` cache shipped.
 *
 * Exact is chosen over a finer bucket (nearest 5, nearest 1) because
 * bucketing exists to absorb imprecision, and there is none here to
 * absorb: this is a small integer — the length of a list of 2-letter
 * codes derived from stored per-state counts — not an estimate. Printing
 * it whole satisfies the round-DOWN rule trivially (the exact value IS
 * its own floor) and can never overstate. Rounding down to 5s could only
 * ever UNDERSTATE by up to 4 states of real, paid-for coverage.
 *
 * The "+" is dropped with the bucketing. It was the honest signal that a
 * displayed number had been rounded off; on an exact figure it would
 * imply an unstated remainder that does not exist. `formatPermitsLabel`
 * and `formatZipsLabel` keep theirs because those two really are rounded.
 */
export function formatStatesLabel(n: number): string {
  return String(Math.max(0, Math.floor(n)));
}

/**
 * Round a ZIP count DOWN to the nearest 1,000 and format as "18,000+".
 * - 18,037 → "18,000+"
 * - 18,999 → "18,000+"
 * -    812 → ""        (below the first bucket — caller should hide the
 *                       stat rather than render a "0+" that reads broken)
 */
export function formatZipsLabel(n: number): string {
  if (n < 1_000) return "";
  const rounded = Math.floor(n / 1_000) * 1_000;
  return `${rounded.toLocaleString("en-US")}+`;
}
