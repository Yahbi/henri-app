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
 *
 * WHAT COUNTS AS A PERMIT
 * Rounding down is not enough if the counted SET is wrong. `permits`
 * also holds rows pulled from endpoints that turned out not to be permit
 * datasets at all — business licences, building footprints, sewer
 * records — which entered through mis-mapped auto-discovered sources.
 * `permit_sources.dataset_kind` is the registry's classification; rows
 * from anything explicitly classified as non-permit are subtracted by
 * the refresh cron before the number is cached. See
 * `fetchNonPermitSources` below and /api/cron/refresh-landing-stats.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALL_US_STATES,
  ACTIVE_STATE_MIN_PERMITS,
  formatPermitsLabel,
  formatStatesLabel,
  formatZipsLabel,
  type UsState,
} from "@/lib/stats/us-states";

// Re-exported so existing server-side imports of these names from
// `@/lib/stats/landing` keep working. Client components must import
// from `@/lib/stats/us-states` directly — this module pulls in the
// service-role Supabase client.
export {
  ALL_US_STATES,
  ACTIVE_STATE_MIN_PERMITS,
  formatPermitsLabel,
  formatStatesLabel,
  formatZipsLabel,
};
export type { UsState };

export interface LandingStats {
  /** Raw permit count — live from `permits` table. */
  permitsCount: number;
  /** "1.4M+" / "1.5M+" — rounded DOWN to nearest 0.1M. */
  permitsLabel: string;
  /** US states carrying enough permit volume to call "covered" — see
   *  ACTIVE_STATE_MIN_PERMITS. */
  activeStates: ReadonlyArray<UsState>;
  /** "30+" / "35+" — rounded DOWN to nearest 5. */
  activeStatesLabel: string;
  /** Lead count (live). */
  leadsCount: number;
  /** Per-state permit counts, keyed by 2-letter code. Drives the coverage
   *  map's volume shading and per-state tooltips. Empty object when the
   *  `landing_stats` cache row is unavailable — renderers must treat a
   *  missing key as "no data", not as zero coverage. */
  statePermits: Readonly<Partial<Record<UsState, number>>>;
  /** Distinct 5-digit ZIP codes with at least one permit. 0 when unknown. */
  zipsCovered: number;
  /** "18,000+" — rounded DOWN to nearest 1,000. Empty string when unknown. */
  zipsCoveredLabel: string;
  /** Computed at fetch time — useful for "Last refreshed" UI. */
  fetchedAt: string;
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
// History of this floor:
//   2026-06-10  1.4M -> 1.5M, after a "clean" count reached 1,553,689.
//   2026-08-04  1.5M -> 1.4M. That 1,553,689 subtracted the state='US'/''
//               /NULL loader artifacts but NOT rows ingested from feeds
//               that are not permit datasets at all (business licences,
//               building footprints, sewer records — see
//               `fetchNonPermitSources` below). Their volume has never
//               been measured, so 1.5M is only 2,191 rows clear of the
//               last independently-audited permit count (1,497,809 on
//               2026-05-13) and cannot survive ANY contamination. A floor
//               that can't be defended isn't a floor. 1.4M can.
//
// Only raise this from a MEASURED count that already excludes non-permit
// sources — i.e. read `permits_total` out of a landing_stats row written
// by /api/cron/refresh-landing-stats after that route learned to subtract
// them, not from a raw `SELECT count(*) FROM permits`.
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
    // No per-state histogram offline: the map degrades to a lit/unlit
    // rendering of FALLBACK_COVERED_STATES rather than showing zeros.
    statePermits: {},
    zipsCovered: 0,
    zipsCoveredLabel: "",
    fetchedAt: new Date().toISOString(),
  };
}

const VALID_STATES = new Set<string>(ALL_US_STATES);

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

/**
 * `permit_sources.dataset_kind` value meaning the registry has POSITIVE
 * evidence this feed is not permits at all — a business-licence roster, a
 * building-footprint layer, a sewer-wye inventory. Endpoints like these
 * entered the catalog through mis-mapped auto-discovery, and their rows sit
 * in `permits` inflating any count taken over the whole table, which breaks
 * the truthfulness rule.
 *
 * The vocabulary is defined by migration 00122's own column comment:
 *   'unknown'    — never probed          (the DEFAULT; most of the catalog)
 *   'permit'     — passed the screen
 *   'non_permit' — positive evidence it is something else
 *
 * Only 'non_permit' is grounds for subtracting rows from a published count.
 * An earlier version keyed off `!= 'permit'`, which was written expecting
 * unclassified rows to be NULL; 00122 shipped `NOT NULL DEFAULT 'unknown'`,
 * so that predicate swept in every never-probed source — 479 of them on the
 * first live run. Treating "we have not looked yet" as "junk" would erase
 * most of the catalog, which is why the subtraction is opt-in on evidence
 * rather than opt-out on absence.
 */
const NON_PERMIT_DATASET_KIND = "non_permit";

export interface NonPermitSource {
  /** The value rows from this feed carry in `permits.source_city`. */
  sourceCity: string;
  /** Registry-declared state, uppercased — null when it isn't a real
   *  2-letter code (older rows carry 'US' or a blank). */
  declaredState: UsState | null;
}

/**
 * Feeds the registry has explicitly classified as NOT permit datasets.
 *
 * GRACEFUL DEGRADE (CLAUDE.md "feature-flags before migrations"): when the
 * `dataset_kind` column does not exist yet, PostgREST answers 42703 and we
 * return an empty list — i.e. "nothing is known to be junk", which is the
 * exact behaviour this codebase had before the column shipped. The read
 * path must never throw on a marketing page.
 *
 * KNOWN IMPRECISION, deliberately biased toward under-claiming:
 * `permits.source_city` is stamped from the source's city (falling back to
 * jurisdiction — see `sources-db.ts`), and several cities carry more than
 * one feed. When a city has both a permit feed and a non-permit feed under
 * the same name, excluding by `source_city` drops the permit rows too. That
 * loses real coverage, but it can only ever make the published number
 * SMALLER, which is the side of the line CLAUDE.md requires. The durable
 * fix is to stamp a source-unique key on `permits` at ingest time so the
 * exclusion can be per-source instead of per-city.
 */
export async function fetchNonPermitSources(
  supabase: SupabaseAdminClient,
): Promise<NonPermitSource[]> {
  const { data, error } = await supabase
    .from("permit_sources")
    .select("city, jurisdiction, state, dataset_kind")
    // Subtract ONLY rows with positive evidence of being non-permit.
    //
    // This was `.neq("dataset_kind", "permit")`, written against an assumed
    // contract where unclassified rows were NULL. Migration 00122 shipped
    // the column as `NOT NULL DEFAULT 'unknown'` instead, so `!= 'permit'`
    // matched every never-probed source: the first live run classified 479
    // of them as junk and the budget guard refused to publish, which is
    // exactly what that guard is for.
    //
    // `= 'non_permit'` is also the semantically correct read. 00122's own
    // column comment defines the vocabulary: 'unknown' = never probed,
    // 'permit' = passed the screen, 'non_permit' = positive evidence of a
    // licence / utility / footprint / wetland layer. Only the last is
    // grounds for excluding rows from a published count — treating
    // "we haven't looked yet" as "junk" would erase most of the catalog.
    .eq("dataset_kind", NON_PERMIT_DATASET_KIND);

  if (error) {
    console.warn(
      "[landing-stats] dataset_kind unavailable — no source is treated as junk:",
      error.message,
    );
    return [];
  }

  const bySourceCity = new Map<string, NonPermitSource>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const sourceCity =
      String(row.city ?? "").trim() || String(row.jurisdiction ?? "").trim();
    if (!sourceCity) continue;
    const declared = String(row.state ?? "").trim().toUpperCase();
    bySourceCity.set(sourceCity, {
      sourceCity,
      declaredState: VALID_STATES.has(declared)
        ? (declared as UsState)
        : null,
    });
  }
  return [...bySourceCity.values()];
}

interface CoveragePayload {
  permits_total?: unknown;
  leads_total?: unknown;
  zips_covered?: unknown;
  state_permits?: unknown;
  computed_at?: unknown;
}

function asPositiveInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0;
}

/**
 * Parse the `landing_stats` cache payload into a LandingStats.
 *
 * Returns null when the row is missing, malformed, or implausibly small —
 * the caller then falls through to the live-count path. Written as a
 * total function over `unknown` because the column is jsonb: a schema
 * drift or a half-written refresh must degrade, never throw on a
 * marketing page.
 */
function parseCoveragePayload(raw: unknown): LandingStats | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as CoveragePayload;

  const permitsCount = asPositiveInt(p.permits_total);
  // Same guard as the live path: we KNOW the catalog is well past this
  // floor, so a small number means a broken read, not a small database.
  if (permitsCount < FALLBACK_PERMITS / 2) return null;

  const statePermits: Partial<Record<UsState, number>> = {};
  if (p.state_permits && typeof p.state_permits === "object") {
    for (const [code, n] of Object.entries(
      p.state_permits as Record<string, unknown>,
    )) {
      const upper = code.toUpperCase();
      if (!VALID_STATES.has(upper)) continue; // drops 'US' / '' / junk
      const count = asPositiveInt(n);
      if (count > 0) statePermits[upper as UsState] = count;
    }
  }

  const activeStates = (Object.keys(statePermits) as UsState[])
    .filter((s) => (statePermits[s] ?? 0) >= ACTIVE_STATE_MIN_PERMITS)
    .sort();

  // A payload with permits but no usable histogram is a partial write;
  // prefer the curated fallback list over rendering an empty map.
  if (activeStates.length === 0) return null;

  const zipsCovered = asPositiveInt(p.zips_covered);

  return {
    permitsCount,
    permitsLabel: formatPermitsLabel(permitsCount),
    activeStates,
    activeStatesLabel: formatStatesLabel(activeStates.length),
    leadsCount: asPositiveInt(p.leads_total),
    statePermits,
    zipsCovered,
    zipsCoveredLabel: formatZipsLabel(zipsCovered),
    fetchedAt:
      typeof p.computed_at === "string"
        ? p.computed_at
        : new Date().toISOString(),
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

  // Preferred path: the `landing_stats` cache (migration 00115). One
  // primary-key lookup, ~1 ms, and it carries the per-state histogram that
  // no request-path query can afford — measured 2026-08-04, the equivalent
  // `GROUP BY state` is a 37s parallel seq scan with an 11 MB external
  // merge, versus PostgREST's 8s ceiling. That gap is exactly why the
  // covered-states list below was frozen as a hand-curated array in May
  // while the database had grown from 25 states to 46.
  //
  // Missing table (migration not yet applied) or missing row both fall
  // through to the legacy count path, so this is safe to deploy in either
  // order.
  try {
    // Promise.resolve() because PostgrestBuilder is a thenable, not a
    // real Promise — Promise.race (inside withTimeout) needs the latter.
    const cached = await withTimeout(
      Promise.resolve(
        supabase
          .from("landing_stats")
          .select("value")
          .eq("key", "coverage")
          .maybeSingle(),
      ),
      STATS_FETCH_TIMEOUT_MS,
      "getLandingStats cache",
    );
    if (!cached.error && cached.data) {
      const parsed = parseCoveragePayload(cached.data.value);
      if (parsed) return parsed;
    }
  } catch (err) {
    console.warn(
      "[landing-stats] coverage cache unavailable, falling back to counts:",
      err instanceof Error ? err.message : String(err),
    );
  }

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
  let nonPermitSources: NonPermitSource[] = [];
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
        // Cheap registry read (12k rows, no join) — tells us whether the
        // whole-table count above is knowingly inflated. See the gate below.
        fetchNonPermitSources(supabase),
      ]),
      STATS_FETCH_TIMEOUT_MS,
      "getLandingStats counts",
    );
    permitsResult = { count: results[0].count };
    leadsResult = { count: results[1].count };
    junkStateCount = results[2].count ?? 0;
    junkNullCount = results[3].count ?? 0;
    nonPermitSources = results[4];
  } catch (err) {
    console.warn(
      "[landing-stats] count fetch failed, using fallback:",
      err instanceof Error ? err.message : String(err),
    );
    return buildFallback();
  }

  // Truthfulness gate for the degraded path. This branch can only produce a
  // whole-table count, and a whole-table count includes every row from feeds
  // the registry has classified as non-permit datasets. Subtracting them
  // needs one count per excluded source; that fan-out belongs in
  // /api/cron/refresh-landing-stats (60s budget, runs once an hour), not in
  // a request path capped at 6s. Rather than publish a total we KNOW
  // overclaims, publish the verified floor — which is the whole point of
  // having one.
  if (nonPermitSources.length > 0) {
    console.warn(
      "[landing-stats] %d non-permit source(s) in the registry and no coverage cache row — the live count would overclaim; using verified fallback floor",
      nonPermitSources.length,
    );
    return buildFallback();
  }

  const cleanPermits = Math.max(
    0,
    (permitsResult.count ?? 0) - junkStateCount - junkNullCount,
  );

  // Truthfulness + resilience guard: the count query can SUCCEED (no
  // throw, so the catch above never fires) yet return null/0 — e.g. the
  // DB is mid-restore, the planner estimate is unavailable, or a
  // transient empty read. The catalog is comfortably above the fallback
  // floor, so we must never render a "0.0M+" understatement on the
  // marketing pages.
  // Treat any null/zero/implausibly-low live count as a failed read and
  // use the hand-verified honest floor instead of the broken live value.
  if (permitsResult.count == null || cleanPermits < FALLBACK_PERMITS / 2) {
    console.warn(
      "[landing-stats] live permit count missing/implausible (",
      permitsResult.count,
      ") — using verified fallback floor",
    );
    return buildFallback();
  }

  const permitsCount = cleanPermits;
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
    // Legacy path has no histogram — the map falls back to lit/unlit.
    statePermits: {},
    zipsCovered: 0,
    zipsCoveredLabel: "",
    fetchedAt: new Date().toISOString(),
  };
}

