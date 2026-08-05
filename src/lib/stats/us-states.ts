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
 * Minimum permits before a state counts as "covered" on the marketing map.
 *
 * Live data has a long tail of states holding a literal handful of rows
 * (RI/VT/AR/ME each had exactly 1 permit on 2026-08-04) — almost always
 * a single mis-geocoded record, not coverage. Counting them would let
 * the headline claim 46 states when a contractor in Rhode Island would
 * find nothing.
 *
 * Tuning this only changes what we CLAIM, never what we store: every
 * state's true count still reaches the map, so the long tail renders as
 * a distinct "seeded" tier rather than disappearing.
 */
export const ACTIVE_STATE_MIN_PERMITS = 500;

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
 * Round a number DOWN to the nearest 5 and format as "30+".
 * - 35 → "35+"
 * - 38 → "35+"
 * - 40 → "40+"
 * - 4  → "0+"   (rare; same fallback caveat as above)
 */
export function formatStatesLabel(n: number): string {
  const rounded = Math.floor(n / 5) * 5;
  return `${rounded}+`;
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
