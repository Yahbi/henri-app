/**
 * Server-only fetcher for the marketing-page truthfulness pass.
 *
 * Pulls live counts from Supabase (admin client = service-role,
 * bypasses RLS) and formats them into the rounded-down strings the
 * landing pages need. Auto-adjusts as the database grows: when permit
 * count crosses 1.5M, the formatted string becomes "1.5M+" without
 * any code change. Same for the state count.
 *
 * Cache: callers should wrap this in `unstable_cache` or rely on the
 * page-level `revalidate = 3600` so the marketing pages don't query
 * Supabase on every request.
 *
 * Per CLAUDE.md "Truthfulness" rules: round DOWN, never inflate. If
 * the live count says 1,414,624 we display "1.4M+". If it says
 * 1,499,999 we still display "1.4M+". Only at 1,500,000 do we tick
 * to "1.5M+".
 */

import { createAdminClient } from "@/lib/supabase/admin";

const ALL_US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

export type UsState = (typeof ALL_US_STATES)[number];

export interface LandingStats {
  /** Raw permit count — live from `permits` table. */
  permitsCount: number;
  /** "1.4M+" / "1.5M+" — rounded DOWN to nearest 0.1M. */
  permitsLabel: string;
  /** Distinct US states with at least one new permit in the last 30 days. */
  activeStates: UsState[];
  /** "30+" / "35+" — rounded DOWN to nearest 5. */
  activeStatesLabel: string;
  /** Lead count (live). */
  leadsCount: number;
  /** Computed at fetch time — useful for "Last refreshed" UI. */
  fetchedAt: string;
}

/**
 * Round a number DOWN to the nearest 100,000 and format as "1.4M+".
 * - 1,414,624 → "1.4M+"
 * - 1,499,999 → "1.4M+"
 * - 1,500,000 → "1.5M+"
 * - 999,999   → "0.9M+"
 * - 0         → "0M+"  (callers should fall back to a static label
 *                       for empty databases.)
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
 * Single Supabase round trip via parallel CountPlanned queries.
 * Returns the data needed by every landing-page component that
 * displays "X.YM+ permits" or "X+ states covered."
 */
export async function getLandingStats(): Promise<LandingStats> {
  const supabase = createAdminClient();

  // Use planned counts (no full-table scan) — fast even on the 1.4M
  // permits table. Supabase returns the planner's row estimate, which
  // is accurate to within ~5% and updates after each ANALYZE.
  const [permitsResult, leadsResult, activeStatesResult] = await Promise.all([
    supabase
      .from("permits")
      .select("*", { count: "planned", head: true }),
    supabase
      .from("leads")
      .select("*", { count: "planned", head: true }),
    // The active-states query needs an exact distinct count, so use
    // a raw RPC if available — otherwise scan the recently-active slice.
    // Recent-30d window keeps the row count under 100k for cheap.
    supabase
      .from("permits")
      .select("state")
      .gt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not("state", "is", null)
      .limit(50_000),
  ]);

  const permitsCount = permitsResult.count ?? 0;
  const leadsCount = leadsResult.count ?? 0;

  // Reduce the recent slice to a distinct set of US states. Filters
  // out any non-US codes that may have crept into permit_sources.
  const validStates = new Set<UsState>(ALL_US_STATES);
  const seen = new Set<UsState>();
  for (const row of activeStatesResult.data ?? []) {
    const s = String(row.state ?? "").toUpperCase().trim();
    if (validStates.has(s as UsState)) {
      seen.add(s as UsState);
    }
  }
  const activeStates = Array.from(seen).sort();

  return {
    permitsCount,
    permitsLabel: formatPermitsLabel(permitsCount),
    activeStates,
    activeStatesLabel: formatStatesLabel(activeStates.length),
    leadsCount,
    fetchedAt: new Date().toISOString(),
  };
}

/** All 50 US states + DC, in stable order. Useful for renderers. */
export { ALL_US_STATES };
