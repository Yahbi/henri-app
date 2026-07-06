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
  pipeline_value, permit_history,
  opportunity_stage, reason_codes, trade_tags,
  source, parcel_sidecar_uid`;

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

/** How many leads the `geocoded_only` filter is hiding from the caller.
 *
 *  The filter above is applied SERVER-side (PostgREST `.not("latitude",
 *  "is", null)`), so the dropped rows never reach the client and can't be
 *  counted from the fetched result. The honest count is derived from the
 *  contractor's total vs. geocoded lead counts, which `/api/leads/count`
 *  (via `useLeadCount`) already returns — no extra query needed.
 *
 *  Mirrors the capacity filter's "never silently drop rows" contract
 *  (src/lib/capacity/types.ts): when the geocode filter is active and
 *  hiding rows, the panel renders "N leads hidden (no map location yet)".
 *
 *  Returns 0 when the filter is inactive or counts haven't loaded yet
 *  (both counts 0 during the count-fetch race) — callers can render
 *  nothing in that case. Pure function, unit-testable. */
export function countHiddenByGeocodeFilter(
  geocodedOnlyActive: boolean,
  totalLeads: number,
  geocodedLeads: number,
): number {
  if (!geocodedOnlyActive) return 0;
  return Math.max(0, totalLeads - geocodedLeads);
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

/* ── Row → Lead mapping ──
 *
 * Extracted from useLeads.ts so it can be unit-tested without React Query.
 * Merges denormalized lead columns (address/city/state/zip/lat/lng) with
 * the joined `permits(...)` row; reads from lead first, falls back to
 * permit. Computes permit_age_days from applied_date or issued_date.
 *
 * Pure function — no I/O, deterministic. Used by:
 *   1. fetchLeads' single-page path (limit ≤ 1000)
 *   2. fetchLeads' progressive-paint path (multi-page god-mode pulls)
 *
 * Audit-04-29 fix: previously inline in useLeads.ts and untested. The
 * fallback-merge logic is subtle (4-way address fallback, lat/lng coercion,
 * permit_age_days null-safety) so a regression here would silently corrupt
 * the dashboard's row shape.
 */
import type { Lead } from "@/types/lead";

export function mapRowsToLeads(rows: Record<string, unknown>[]): Lead[] {
  const deduped = dedupRowsById(rows);
  const mapped = deduped.map((row: Record<string, unknown>) => {
    const permit = row.permits as Record<string, unknown> | null;
    return {
      ...row,
      address:
        (row.address as string | null) ??
        (permit?.address as string | null) ??
        (row.mailing_address as string | null) ??
        "Unknown",
      // Audit-04-29: every absent merged field returns `null`, never
      // `undefined`. Without the trailing `?? null`, `permit?.city` on a
      // null permit produces `undefined`, breaking downstream null-checks.
      // permit_filed_date already had this discipline; aligning the rest.
      city:
        (row.city as string | null) ??
        (permit?.city as string | null) ??
        null,
      state:
        (row.state as string | null) ??
        (permit?.state as string | null) ??
        null,
      zip:
        (row.zip as string | null) ??
        (permit?.zip as string | null) ??
        "",
      permit_type:
        (row.permit_type as string | null) ??
        (permit?.permit_type as string | null) ??
        null,
      // permit_description is not denormalized; the drawer loads it via
      // usePermitDetail. Keep the field on the Lead shape for downstream
      // consumers but populate from the joined row when available.
      permit_description: (permit?.description as string | null) ?? null,
      permit_value:
        (row.permit_value as number | null) ??
        (permit?.estimated_value as number | null) ??
        null,
      permit_filed_date:
        (permit?.applied_date as string | null) ??
        (permit?.issued_date as string | null) ??
        null,
      permit_age_days: (() => {
        const d = (permit?.applied_date ?? permit?.issued_date) as
          | string
          | null
          | undefined;
        if (!d) return null;
        return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
      })(),
      latitude:
        (row.latitude as number | null) ??
        (permit?.latitude as number | null) ??
        null,
      longitude:
        (row.longitude as number | null) ??
        (permit?.longitude as number | null) ??
        null,
    } as Lead;
  });
  return dedupByAddress(mapped);
}

/** Normalize a street address for grouping: lowercase, collapse whitespace,
 *  strip separators/unit noise so "80 Seymour St", "80 SEYMOUR ST." and
 *  "80  seymour  st" all key the same. */
function normalizeAddressKey(address: string | null | undefined): string {
  return (address ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse leads to ONE per physical address so a property with several
 *  permits shows a single card (2026-06 customer-readiness fix — the leads
 *  list was cluttered with the same address repeated per permit).
 *
 *  Keeps the FIRST lead seen per (address, zip) — callers fetch ordered by
 *  score DESC, so that's the highest-scored/most-actionable permit at the
 *  address — and stamps `cascade_count` with the true number of permits at
 *  that address so the card can surface "N permits here". Leads with no
 *  usable address ("Unknown"/empty) are never collapsed. Order-preserving.
 *  Exported for unit tests. O(n). */
export function dedupByAddress(leads: Lead[]): Lead[] {
  const firstIndexForKey = new Map<string, number>();
  const permitCountForKey = new Map<string, number>();
  const out: Lead[] = [];

  for (const lead of leads) {
    const norm = normalizeAddressKey(lead.address);
    if (!norm || norm === "unknown") {
      out.push(lead); // no reliable address — keep every one
      continue;
    }
    const key = `${norm}|${(lead.zip ?? "").trim()}`;
    permitCountForKey.set(key, (permitCountForKey.get(key) ?? 0) + 1);
    if (firstIndexForKey.has(key)) continue; // already kept the best for this address
    firstIndexForKey.set(key, out.length);
    out.push(lead);
  }

  // Reflect the real permit count on each kept lead (max of any existing
  // cascade_count and the group size).
  for (const [key, idx] of firstIndexForKey) {
    const n = permitCountForKey.get(key) ?? 1;
    const existing = (out[idx] as { cascade_count?: number | null }).cascade_count ?? 1;
    if (n > 1 || existing > 1) {
      out[idx] = { ...out[idx], cascade_count: Math.max(existing, n) } as Lead;
    }
  }

  return out;
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
