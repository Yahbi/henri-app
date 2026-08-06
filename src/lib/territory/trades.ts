/**
 * The `trade_type` enum, mirrored for TypeScript.
 *
 * Single source for the ten values declared in
 * `supabase/migrations/00002_profiles.sql:9-15`. Territory exclusivity is
 * per (zip, trade) since migration 00135, so this list is now load-bearing
 * in three places that must not drift apart:
 *
 *   1. `/onboarding/license` — where the contractor picks the trade that
 *      gets frozen onto every territory they later claim.
 *   2. `/onboarding/territory` — which asks availability for THAT trade.
 *   3. `/api/territories/[zip]` — which refuses to forward anything that
 *      is not a real enum label, because `get_zip_availability(p_zip,
 *      p_trade)` types its second argument as `public.trade_type` and a
 *      bad label is a 500 from Postgres rather than a 400 from us.
 *
 * Deliberately NOT imported from `ziplock.ts`: that module pulls in the
 * service-role Supabase client, and both onboarding pages are client
 * components. This file has no imports so it is safe in the browser bundle.
 */

export const TRADE_TYPES = [
  "general",
  "roofing",
  "plumbing",
  "electrical",
  "hvac",
  "solar",
  "landscaping",
  "painting",
  "concrete",
  "other",
] as const;

export type TradeType = (typeof TRADE_TYPES)[number];

/** Human labels for the picker. Kept next to the values so a new enum
 *  member can't ship with a raw slug rendered in the UI. */
export const TRADE_LABELS: Record<TradeType, string> = {
  general: "General contractor",
  roofing: "Roofing",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  solar: "Solar",
  landscaping: "Landscaping",
  painting: "Painting",
  concrete: "Concrete",
  other: "Other",
};

export function isTradeType(value: unknown): value is TradeType {
  return typeof value === "string" && (TRADE_TYPES as readonly string[]).includes(value);
}

/** Render a trade for display, falling back to the raw value rather than
 *  dropping it — an unknown label is information, an empty string is not. */
export function tradeLabel(value: string | null | undefined): string {
  if (!value) return "your trade";
  return isTradeType(value) ? TRADE_LABELS[value] : value;
}
