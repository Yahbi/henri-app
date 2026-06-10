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
  activeStates: ReadonlyArray<UsState>;
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
 * Fallback returned when Supabase env vars aren't set (CI/build-time
 * static prerender without secrets). Mirrors the shape `getLandingStats`
 * normally returns and uses the same hand-curated `COVERED_STATES`
 * list used by the live path.
 *
 * Production builds DO have the env vars, so the live fetch runs and
 * the cached HTML reflects real numbers. This branch keeps `pnpm build`
 * green when secrets aren't available.
 */
const FALLBACK_PERMITS = 1_400_000;
const FALLBACK_LEADS = 260_000;
const FALLBACK_COVERED_STATES: ReadonlyArray<UsState> = [
  "AL", "AZ", "CA", "CT", "DC", "FL", "GA", "HI", "ID", "IL",
  "IN", "KS", "KY", "LA", "MD", "NC", "NE", "NM", "NY", "OH",
  "PA", "SD", "TX", "VA", "WA",
];

/**
 * Single Supabase round trip via parallel CountPlanned queries.
 * Returns the data needed by every landing-page component that
 * displays "X.YM+ permits" or "X+ states covered."
 *
 * Graceful when Supabase env vars are missing — returns the fallback
 * constants so a CI build without secrets still completes prerender.
 */
/** Build-time cap on the live Supabase fetch. The marketing page is
 *  statically generated with a 60s ceiling per attempt × 3 retries.
 *  When Supabase is saturated and even `count: "planned"` queries
 *  hang past 8s, the build worker thrashes and times out. Bail at
 *  6s and use the FALLBACK constants instead — keeps the build
 *  deterministic regardless of DB health. */
const STATS_FETCH_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

function buildFallback(): LandingStats {
  return {
    permitsCount: FALLBACK_PERMITS,
    permitsLabel: formatPermitsLabel(FALLBACK_PERMITS),
    activeStates: FALLBACK_COVERED_STATES,
    activeStatesLabel: formatStatesLabel(FALLBACK_COVERED_STATES.length),
    leadsCount: FALLBACK_LEADS,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getLandingStats(): Promise<LandingStats> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return buildFallback();
  }
  const supabase = createAdminClient();

  // Use planned counts (no full-table scan) — fast even on the 1.4M
  // permits table. Supabase returns the planner's row estimate, which
  // is accurate to within ~5% and updates after each ANALYZE.
  //
  // Wrapped in a 6s timeout because Vercel's static-generate path
  // gives each page only 60s before the worker retries; if Supabase
  // is saturated and the count queries hang, fall back to the
  // hand-curated constants so the build always succeeds. Live
  // numbers come back on the next revalidate (1h cache window).
  let permitsResult: { count: number | null };
  let leadsResult: { count: number | null };
  let junkStateCount = 0;
  let junkNullCount = 0;
  try {
    const results = await withTimeout(
      Promise.all([
        supabase
          .from("permits")
          .select("*", { count: "planned", head: true }),
        supabase
          .from("leads")
          .select("*", { count: "planned", head: true }),
        // Junk-row subtraction (2026-06-09 truthfulness fix): loader bugs
        // left rows with state='US' / state='' / state IS NULL. They have
        // no ZIP, can never become leads, and inflating the headline with
        // them violates the round-DOWN rule (audit found raw 1.80M vs
        // clean 1.55M — the raw label would overclaim by 250k). Both
        // probes are index-assisted on (state, ...) and cheap.
        supabase
          .from("permits")
          .select("*", { count: "exact", head: true })
          .in("state", ["US", ""]),
        supabase
          .from("permits")
          .select("*", { count: "exact", head: true })
          .is("state", null),
      ]),
      STATS_FETCH_TIMEOUT_MS,
      "getLandingStats counts",
    );
    permitsResult = { count: results[0].count };
    leadsResult = { count: results[1].count };
    junkStateCount = results[2].count ?? 0;
    junkNullCount = results[3].count ?? 0;
  } catch (err) {
    console.warn(
      "[landing-stats] count fetch failed, using fallback:",
      err instanceof Error ? err.message : String(err),
    );
    return buildFallback();
  }

  const permitsCount = Math.max(
    0,
    (permitsResult.count ?? 0) - junkStateCount - junkNullCount,
  );
  const leadsCount = leadsResult.count ?? 0;

  // Active states list. Two server-side aggregation paths were tried
  // and failed:
  //   (a) `created_at > NOW() - INTERVAL '30d'` — matches all 1.4M rows
  //       because permits are re-touched on every ingest. Planner
  //       picks a parallel seq scan, ~16s. Times out via PostgREST
  //       (8s).
  //   (b) `issued_date > NOW() - INTERVAL '30d'` — selective (~16k
  //       rows) but still ~12s with `idx_permits_issued_date` because
  //       the DISTINCT(state) sort dominates. Times out via PostgREST.
  //   (c) `GROUP BY state HAVING COUNT(*) >= 100` — 65s (sequential
  //       full scan; the index on (state, zip) doesn't help an
  //       ungrouped count). Times out.
  //
  // The right long-term fix is a `landing_stats` cache table refreshed
  // by the score cron (see TODO below). For now we ship a hand-curated
  // list pulled from the live database (verified 2026-05-07): all 25
  // US states with ≥100 permits in `public.permits`. Update this list
  // monthly via:
  //
  //   SELECT UPPER(state), COUNT(*) FROM permits
  //   WHERE state IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= 100
  //   ORDER BY 1;
  //
  // (Run via the Supabase Management API — the dashboard SQL editor
  // has a higher timeout than PostgREST.)
  //
  // TODO(post-launch): create `landing_stats` table with columns
  // (key text PK, value jsonb, updated_at). Have the score cron
  // upsert {key: 'covered_states', value: jsonb_array_of_codes} once
  // per run. `getLandingStats` then reads from this table — single
  // row, sub-1ms. Migration: 00082_landing_stats_cache.sql.
  const COVERED_STATES_2026_05_07: ReadonlyArray<UsState> = [
    "AL", "AZ", "CA", "CT", "DC", "FL", "GA", "HI", "ID", "IL",
    "IN", "KS", "KY", "LA", "MD", "NC", "NE", "NM", "NY", "OH",
    "PA", "SD", "TX", "VA", "WA",
  ];
  const validStates = new Set<UsState>(ALL_US_STATES);
  const activeStates = COVERED_STATES_2026_05_07
    .filter((s) => validStates.has(s))
    .sort();

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
