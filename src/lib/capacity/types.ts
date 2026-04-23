/* ── Capacity preferences — Phase 0a wedge #7 ───────────────────────── */
/*                                                                      */
/*  "Too many leads is a liability." Contractors with limited crews     */
/*  need to filter out everything outside their actual working envelope */
/*  BEFORE the scorer hands them a lead they can't do anything with.    */
/*                                                                      */
/*  Stored as jsonb on `profiles.capacity_prefs` (migration 00031).     */
/*  When the column is missing (pre-migration) every helper returns     */
/*  the "no filter" defaults so the Leads tab shows everything.         */

export interface CapacityPrefs {
  /** Max miles from the contractor's primary ZIP. null = no cap. */
  max_radius_miles: number | null;
  /** Min permit value in dollars. null = no floor. */
  value_min: number | null;
  /** Max permit value in dollars. null = no ceiling. */
  value_max: number | null;
  /** Earliest desired start date (ISO yyyy-mm-dd). null = any. */
  start_window_start: string | null;
  /** Latest desired start date (ISO yyyy-mm-dd). null = any. */
  start_window_end: string | null;
  /** Max concurrent active jobs the crew can run. null = no cap. */
  max_active_jobs: number | null;
  /** Preferred work days — ISO day numbers 1-7 (Mon-Sun). Empty = any. */
  preferred_days_of_week: number[];
}

export const EMPTY_CAPACITY_PREFS: CapacityPrefs = {
  max_radius_miles: null,
  value_min: null,
  value_max: null,
  start_window_start: null,
  start_window_end: null,
  max_active_jobs: null,
  preferred_days_of_week: [],
};

export function isCapacityPrefs(value: unknown): value is CapacityPrefs {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const numOrNull = (x: unknown) => x === null || typeof x === "number";
  const strOrNull = (x: unknown) => x === null || typeof x === "string";
  return (
    numOrNull(v.max_radius_miles) &&
    numOrNull(v.value_min) &&
    numOrNull(v.value_max) &&
    strOrNull(v.start_window_start) &&
    strOrNull(v.start_window_end) &&
    numOrNull(v.max_active_jobs) &&
    Array.isArray(v.preferred_days_of_week)
  );
}

/** True if the prefs object has at least one active filter. */
export function hasActivePrefs(p: CapacityPrefs): boolean {
  return (
    p.max_radius_miles != null ||
    p.value_min != null ||
    p.value_max != null ||
    p.start_window_start != null ||
    p.start_window_end != null ||
    p.max_active_jobs != null ||
    (p.preferred_days_of_week?.length ?? 0) > 0
  );
}

/** Short human-readable summary for the filter-bar chip. */
export function summarizePrefs(p: CapacityPrefs): string {
  if (!hasActivePrefs(p)) return "No capacity filter";
  const parts: string[] = [];
  if (p.max_radius_miles != null) parts.push(`\u2264${p.max_radius_miles}mi`);
  if (p.value_min != null && p.value_max != null) {
    parts.push(`$${fmt(p.value_min)}\u2013$${fmt(p.value_max)}`);
  } else if (p.value_min != null) {
    parts.push(`\u2265$${fmt(p.value_min)}`);
  } else if (p.value_max != null) {
    parts.push(`\u2264$${fmt(p.value_max)}`);
  }
  if (p.max_active_jobs != null) parts.push(`max ${p.max_active_jobs} active`);
  return parts.join(" \u00b7 ");
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/**
 * Apply capacity filters to a list of leads on the client. Keep this
 * fast — no DB lookups, just field-based predicates. The scorer will
 * eventually hide permits entirely server-side (Phase A task), but
 * for Phase 0a we filter client-side so the user always sees "N leads
 * filtered out — widen to see" and can verify the filter works.
 */
export interface LeadForCapacityFilter {
  rawValue?: number | null;
  permitAge?: number | null;
  // Future: lat/lng + contractor home ZIP for radius math.
}

export function applyCapacityFilter<T extends LeadForCapacityFilter>(
  leads: T[],
  prefs: CapacityPrefs,
): T[] {
  if (!hasActivePrefs(prefs)) return leads;
  return leads.filter((lead) => {
    // Exclude null-value leads from value filtering — they pass through.
    // Previously rawValue??0 / ??Infinity silently dropped all leads without
    // known permit values whenever any range filter was active.
    if (prefs.value_min != null && lead.rawValue != null && lead.rawValue < prefs.value_min) return false;
    if (prefs.value_max != null && lead.rawValue != null && lead.rawValue > prefs.value_max) return false;
    // max_radius_miles + start_window + max_active_jobs require
    // additional data (contractor home ZIP geocode, lead location,
    // active-job count) not yet plumbed client-side. Those filters
    // become effective in Phase A when the scorer applies them
    // server-side and the lead shape carries `miles_from_home`.
    return true;
  });
}
