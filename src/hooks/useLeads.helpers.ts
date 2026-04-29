/**
 * Pure helpers for `useLeads.ts` — extracted to enable unit testing without
 * pulling in React Query. The hook proper still owns the React-Query state
 * machine (queryKey, staleTime, optimistic mutations) — these are just the
 * supabase-builder + post-processing pieces that the audit-priority-#5 list
 * flagged at 0% coverage.
 *
 * Why an extraction was justified:
 *   • The filter-application logic was duplicated 3x in useLeads.ts (initial
 *     query, narrow-fallback retry, multi-page god-mode loop).
 *   • CLAUDE.md "client-side fallback first" means this code must keep
 *     working across pre/post-migration schemas; the only way to verify
 *     that contract without a live DB is unit tests.
 *   • The dedupe + missing-column detection were silent until they fired
 *     in production — turning them into pure functions makes them testable.
 *
 * The hook in `./useLeads.ts` re-exports these helpers from this module,
 * so production code paths are unchanged. The public API of `useLeads()`
 * itself is untouched.
 */
import type { LeadFilters, LeadSortField, LeadSortDir } from "@/types/lead";

/* ── SELECT lists ── (moved from useLeads.ts; same strings)
 *
 * SELECT_WIDE is the post-migration shape (00039 contact provenance +
 * 00044 extended enrichment). SELECT_NARROW is the pre-migration legacy
 * shape that ships today.
 */
export const COLUMNS_NARROW = `
  id, contractor_id, permit_id,
  score, urgency, status,
  trade, notes, phone, email,
  mailing_address, cascade_flag, cascade_count,
  score_freshness, score_value, score_contact, score_demand,
  score_engagement, score_conversion, score_signals,
  contacted_at, won_at, created_at,
  latitude, longitude,
  owner_name, owner_first, owner_last,
  year_built, home_sqft, lot_sqft,
  assessed_value, property_value, owner_occupied, owner_since,
  pipeline_value, permit_history`;

export const COLUMNS_EXTENDED = `,
  contact_source, contact_confidence,
  employer, occupation,
  business_phone, business_status, business_website,
  license_number, license_status, naics_code,
  cross_trade_suggestions`;

/* Denormalized permit fields written to the leads table by migration 00019
 * + populated by the score cron at scoring time. Reading these instead of
 * embedding `permits(...)` lets us bypass Postgres's 8-second statement
 * timeout on paginated god-mode pulls (see B1 in
 * `~/.claude/plans/composed-questing-lighthouse.md`). The denormalized
 * subset is everything the LeadCard needs to render — heavier permit
 * fields (description, applicant_name, applied_date, …) load on demand
 * via `usePermitDetail` when the drawer opens. */
export const COLUMNS_DENORM_PERMIT = `,
  address, city, state, zip,
  permit_type, permit_value`;

export const PERMITS_JOIN = `,
  permits (
    id, address, city, state, zip,
    permit_type, description, status,
    estimated_value, applied_date, issued_date, completed_date,
    latitude, longitude,
    applicant_name, contractor_name
  )`;

export const SELECT_WIDE = COLUMNS_NARROW + COLUMNS_EXTENDED + PERMITS_JOIN;
export const SELECT_NARROW = COLUMNS_NARROW + PERMITS_JOIN;
/** Dashboard-narrow: WIDE columns minus the permits(...) embed, plus the
 *  denormalized permit fields the LeadCard needs. ~10× faster on paginated
 *  pulls because Postgres can stream from a single (contractor_id, score)
 *  index instead of doing a hash-join into the permits table per page. */
export const SELECT_DASHBOARD_NARROW =
  COLUMNS_NARROW + COLUMNS_EXTENDED + COLUMNS_DENORM_PERMIT;
/** Dashboard-narrow without the extended-enrichment columns. Used as a
 *  retry shape on environments that haven't applied migration 00039/00044. */
export const SELECT_DASHBOARD_NARROW_LEGACY =
  COLUMNS_NARROW + COLUMNS_DENORM_PERMIT;

/** True when the supabase error message indicates one of the columns in
 *  the wide SELECT didn't exist (PostgREST returns either of the two
 *  phrasings depending on whether the column or the column-list was the
 *  problem). Used to trigger the narrow-fallback retry. */
export function isMissingColumnErr(message: string): boolean {
  return /does not exist|Could not find the column/i.test(message);
}

/* ── Minimal supabase-query builder shape ──
 *
 * The full SupabaseClient builder is enormous. For these helpers we only
 * need the chainable subset that filter / sort application uses. Tests
 * pass in their own duck-typed mock; production passes a real PostgREST
 * builder (which structurally matches this shape).
 */
export interface LeadsQueryBuilder {
  eq: (column: string, value: unknown) => LeadsQueryBuilder;
  in: (column: string, values: readonly unknown[]) => LeadsQueryBuilder;
  not: (column: string, operator: string, value: unknown) => LeadsQueryBuilder;
  gte: (column: string, value: unknown) => LeadsQueryBuilder;
  lte: (column: string, value: unknown) => LeadsQueryBuilder;
  order: (column: string, options?: { ascending: boolean }) => LeadsQueryBuilder;
}

/** Apply the optional contractor_id gate. God-mode (founder/dev allowlist)
 *  bypasses; subscription tiers (Founder 3 ZIPs / Starter 5 / Pro 12 /
 *  Enterprise 20) cap regular contractors via this `.eq()`. */
export function applyContractorScope<Q extends LeadsQueryBuilder>(
  query: Q,
  godMode: boolean,
  userId: string,
): Q {
  if (!godMode) {
    return query.eq("contractor_id", userId) as Q;
  }
  return query;
}

/** Apply the LeadFilters subset to the query. Mirrors useLeads.ts exactly —
 *  any drift here is a bug. */
export function applyLeadFilters<Q extends LeadsQueryBuilder>(
  query: Q,
  filters?: LeadFilters,
): Q {
  if (!filters) return query;
  let q = query;
  if (filters.urgency) q = q.eq("urgency", filters.urgency) as Q;
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      q = q.in("status", filters.status) as Q;
    } else {
      q = q.eq("status", filters.status) as Q;
    }
  }
  if (filters.trade) q = q.eq("trade", filters.trade) as Q;
  if (filters.cascade_only) q = q.eq("cascade_flag", true) as Q;
  if (filters.geocoded_only) {
    // Filter on leads.latitude (denormalized in migration 00019, index-backed)
    // — NOT on permits.latitude via the join. Nested-join not-null filters
    // can't use the permits index and trigger a Supabase statement timeout
    // on large data sets.
    q = q.not("latitude", "is", null).not("longitude", "is", null) as Q;
  }
  if (filters.min_score) q = q.gte("score", filters.min_score) as Q;
  if (filters.max_score) q = q.lte("score", filters.max_score) as Q;
  return q;
}

/** Apply ORDER BY clauses. Always pairs the user-chosen sort with `id ASC`
 *  as a stable tiebreaker — without it, two `.range()` calls paginating
 *  over rows that share a `score` (very common — thousands of leads at
 *  the same 50/60/70 band) can return OVERLAPPING sets because Postgres
 *  is free to reorder equal-sort-key rows between statements.
 *
 *  When skipSort is true (geocoded_only paths) we skip both — the latitude
 *  index handles ordering and adding score-sort would force the planner
 *  off the index. */
export function applyLeadSort<Q extends LeadsQueryBuilder>(
  query: Q,
  sortBy: LeadSortField,
  sortDir: LeadSortDir,
  skipSort: boolean,
): Q {
  if (skipSort) return query;
  const ascending = sortDir === "asc";
  return query
    .order(sortBy, { ascending })
    .order("id", { ascending: true }) as Q;
}

/** Defensive dedupe — even with a stable tiebreaker, a cached + rewritten
 *  Supabase view or a future refactor could re-introduce row-overlap
 *  across pages. Dedupe on id before mapping so the downstream
 *  `key={lead.id}` render is always unique. O(n).
 *
 *  Returns the deduped array. Caller compares lengths to decide if a
 *  warning log should fire. */
export function dedupRowsById<R extends { id?: string | unknown }>(
  rows: R[],
): R[] {
  const seenIds = new Set<string>();
  const deduped: R[] = [];
  for (const row of rows) {
    const id = row.id as string | undefined;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    deduped.push(row);
  }
  return deduped;
}

/** Resolve the SELECT list given the page-load fallback flag and whether
 *  the caller wants to skip the heavy `permits(...)` embed. Existing
 *  leads keep rendering even on envs that haven't applied 00039 / 00044
 *  yet, and post-migration the new fields surface automatically without
 *  a code change.
 *
 *  When `skipPermitsJoin` is true, the SELECT reads the denormalized
 *  permit fields straight off the leads table (migration 00019). Heavier
 *  permit fields (description, applicant_name, dates) load on demand via
 *  `usePermitDetail` when the drawer opens. Used by god-mode dashboard
 *  pulls so we can scale past the 3,000-row Supabase statement-timeout
 *  ceiling that the JOIN imposes. */
export function resolveSelect(
  extendedColumnsMissing: boolean,
  skipPermitsJoin = false,
): string {
  if (skipPermitsJoin) {
    return extendedColumnsMissing
      ? SELECT_DASHBOARD_NARROW_LEGACY
      : SELECT_DASHBOARD_NARROW;
  }
  return extendedColumnsMissing ? SELECT_NARROW : SELECT_WIDE;
}
