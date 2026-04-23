import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Paginated fetch of every territory row for a contractor.
 *
 * PostgREST silently caps single `.select().eq()` responses at 1000 rows.
 * The founder + any future nationwide contractor will have more than 1000
 * claimed ZIPs, and the silent truncation drops ~80% of their territories
 * (and the downstream leads filtered by `zip IN (...)`). Every API route
 * that resolves a contractor's territory coverage must paginate; this
 * helper is the canonical way.
 *
 * Usage:
 *   const zips = await fetchAllTerritoryZips(supabase, userId);
 *   // zips is string[] — ["06106", "06107", ...]
 *
 *   const territories = await fetchAllTerritories(supabase, userId, "id, zip, claimed_at");
 *   // returns the full select; caller shapes the type.
 */
export async function fetchAllTerritoryZips(
  supabase: SupabaseClient,
  contractorId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<string[]> {
  const zips: string[] = [];
  const PAGE = 1000;
  const SAFETY_CAP = 60_000; // 60k > any realistic contractor coverage
  for (let offset = 0; offset < SAFETY_CAP; offset += PAGE) {
    let q = supabase
      .from("territories")
      .select("zip")
      .eq("contractor_id", contractorId)
      .range(offset, offset + PAGE - 1);
    if (opts.activeOnly) q = q.eq("status", "active");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    zips.push(...(data.map((r) => (r as { zip: string }).zip).filter(Boolean)));
    if (data.length < PAGE) break;
  }
  return zips;
}

/**
 * Paginated select for richer territory rows. Accepts an explicit select
 * string because different callers want different columns (the compliance
 * page needs status/timestamps; the dashboard just needs zip + claimed_at).
 */
export async function fetchAllTerritories<T>(
  supabase: SupabaseClient,
  contractorId: string,
  select: string,
  opts: { activeOnly?: boolean; orderBy?: { column: string; ascending?: boolean } } = {},
): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  const SAFETY_CAP = 60_000;
  for (let offset = 0; offset < SAFETY_CAP; offset += PAGE) {
    let q = supabase
      .from("territories")
      .select(select)
      .eq("contractor_id", contractorId)
      .range(offset, offset + PAGE - 1);
    if (opts.activeOnly) q = q.eq("status", "active");
    if (opts.orderBy) q = q.order(opts.orderBy.column, { ascending: opts.orderBy.ascending ?? false });
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}
