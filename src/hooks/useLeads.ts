"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { isGodModeEmail } from "@/lib/auth/god-mode";
import { logger } from "@/lib/logger";
import type { Lead, LeadQueryParams, LeadStatusUpdate, LeadStatus } from "@/types/lead";
import {
  SELECT_NARROW,
  SELECT_DASHBOARD_NARROW_LEGACY,
  resolveSelect,
  isMissingColumnErr,
  applyContractorScope,
  applyLeadFilters,
  applyLeadSort,
  dedupRowsById,
} from "./useLeads.helpers";

const LEADS_KEY = "leads";

/* ── SELECT lists ──
 * The SELECT_WIDE / SELECT_NARROW constants live in `./useLeads.helpers`
 * so the duplicated filter/sort application logic across the three fetch
 * branches below can share a single source of truth. See that file for
 * the column lists and the rationale for the wide/narrow fallback.
 *
 * Per CLAUDE.md "client-side fallback first" rule, we try WIDE; on a
 * "column does not exist" error we cache that fact for the session and
 * fall back to NARROW. Existing leads keep rendering even on envs that
 * haven't applied 00039 / 00044 yet, and post-migration the new fields
 * surface automatically without a code change.
 *
 * The fallback flag is module-scoped so a single probe per page-load
 * suffices — a cold dashboard load with old schema will pay one extra
 * round trip, then every subsequent fetch goes straight to NARROW. */

/** Set to true after a "column does not exist" error so we skip the wide
 *  probe on subsequent fetches in this page load. Reset by full reload. */
let extendedColumnsMissing = false;

/* ── Row → Lead mapping ──
 *
 * Extracted so the progressive-paint path (multi-page god-mode pulls)
 * can map each page's rows incrementally and write them to the React
 * Query cache before subsequent pages land. Pure function — no I/O. */
function mapRowsToLeads(rows: Record<string, unknown>[]): Lead[] {
  const deduped = dedupRowsById(rows);
  return deduped.map((row: Record<string, unknown>) => {
    const permit = row.permits as Record<string, unknown> | null;
    return {
      ...row,
      address:
        (row.address as string | null) ??
        (permit?.address as string | null) ??
        (row.mailing_address as string | null) ??
        "Unknown",
      city: (row.city as string | null) ?? (permit?.city as string | null),
      state: (row.state as string | null) ?? (permit?.state as string | null),
      zip:
        (row.zip as string | null) ??
        (permit?.zip as string | null) ??
        "",
      permit_type:
        (row.permit_type as string | null) ??
        (permit?.permit_type as string | null),
      permit_description: permit?.description, // not denormalized; loads via usePermitDetail in drawer
      permit_value:
        (row.permit_value as number | null) ??
        (permit?.estimated_value as number | null),
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
}

/** Optional progressive-paint hook. When provided, `fetchLeads` calls
 *  `commit(currentRows)` after each successful page lands so React Query's
 *  cache picks up the partial result and the dashboard panel paints
 *  while later pages are still in flight. Closes Move 2 in the
 *  "show all leads" plan. */
interface ProgressiveCommit {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
}

/* ── Fetch leads from Supabase ── */
async function fetchLeads(
  params?: LeadQueryParams,
  progressive?: ProgressiveCommit,
): Promise<Lead[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Unauthenticated: return empty. Middleware redirects to /login for any
  // dashboard route, so this branch should not actually render. Deliberately
  // NOT falling back to mock/demo/Socrata — the authenticated app always
  // shows the user's own Supabase data, never placeholder content.
  if (!user) return [];

  // God-mode (founder/dev allowlist) bypasses the contractor_id filter.
  // Subscription tiers (Founder 3 ZIPs / Starter 5 / Pro 12 / Enterprise
  // 20) still cap regular contractors via the .eq() inside applyContractorScope.
  const godMode = isGodModeEmail(user.email);

  const f = params?.filters;
  const sortBy = params?.sort_by ?? "score";
  const sortDir = params?.sort_dir ?? "desc";
  const skipSort = params?.skip_sort === true;
  const skipPermitsJoin = params?.skip_permits_join === true;

  /** Build a fresh leads-query builder. Supabase query builders are
   *  single-use once `.range()` is applied, so each fetch path below
   *  rebuilds via this helper rather than mutating a shared `query`. */
  type Row = Record<string, unknown>;
  // The supabase JS client's typed builder is intentionally narrow here so
  // we can swap in the duck-typed helpers from useLeads.helpers.ts. The
  // `as never` cast is required because PostgrestFilterBuilder isn't
  // structurally compatible with our minimal LeadsQueryBuilder shape (it's
  // a strict subset). Production runtime is unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildQuery = (): any => {
    let q = supabase
      .from("leads")
      .select(resolveSelect(extendedColumnsMissing, skipPermitsJoin));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = applyContractorScope(q as any, godMode, user.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = applyLeadFilters(q as any, f);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = applyLeadSort(q as any, sortBy, sortDir, skipSort);
    return q;
  };

  const limit = params?.limit ?? 50;
  const page = params?.page ?? 0;
  const startOffset = page * limit;

  // Supabase PostgREST caps every response at 1000 rows regardless of the
  // requested limit. When the caller asks for more (god-mode users fetching
  // up to 5,000 leads), paginate with .range() until we hit the requested
  // count or the result set runs out.
  const PAGE_SIZE = 1000;
  let data: Row[] = [];
  if (limit <= PAGE_SIZE) {
    const { data: rows, error } = await buildQuery().range(
      startOffset,
      startOffset + limit - 1,
    );
    if (error) {
      // Migration 00039 / 00044 not applied yet on this env: drop the
      // extended columns and retry from scratch. Cache the verdict so
      // the next fetch in this session goes straight to NARROW. The
      // single-page branch (limit ≤ 1000) is the cold-start path the
      // dashboard hits first, so we only need the retry here.
      if (!extendedColumnsMissing && isMissingColumnErr(error.message)) {
        logger.warn("useLeads: extended columns missing; falling back to narrow SELECT for this session", {
          error: error.message,
        });
        extendedColumnsMissing = true;
        // Re-apply filters + sort against the narrow SELECT. Honor the
        // skip_permits_join flag so god-mode dashboard pulls retry without
        // the heavy embed (otherwise we'd swap a missing-column error for
        // a statement-timeout error).
        const fallbackSelect = skipPermitsJoin
          ? SELECT_DASHBOARD_NARROW_LEGACY
          : SELECT_NARROW;
        let fb = supabase.from("leads").select(fallbackSelect);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fb = applyContractorScope(fb as any, godMode, user.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fb = applyLeadFilters(fb as any, f);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fb = applyLeadSort(fb as any, sortBy, sortDir, skipSort);
        const { data: rows2, error: err2 } = await fb.range(
          startOffset,
          startOffset + limit - 1,
        );
        if (err2) throw err2;
        data = rows2 ?? [];
      } else {
        throw error;
      }
    } else {
      data = rows ?? [];
    }
  } else {
    for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
      const take = Math.min(PAGE_SIZE, limit - offset);
      // Must rebuild the query per page — Supabase query builders are
      // single-use once .range() is applied.
      const { data: rows, error } = await buildQuery().range(
        startOffset + offset,
        startOffset + offset + take - 1,
      );
      if (error) {
        // Partial-result tolerance for god-mode fetches of 20k+ leads: if a
        // later page hits the Supabase statement timeout, return what we have
        // rather than throwing and showing an empty panel.
        logger.warn("useLeads: page failed; returning rows collected so far", {
          offset: startOffset + offset,
          error: error.message,
          collected: data.length,
        });
        break;
      }
      if (!rows || rows.length === 0) break;
      data.push(...(rows as Row[]));
      // Move 2 — progressive paint: commit the cumulative deduped+mapped
      // rows to React Query's cache after every page. The dashboard's
      // panel renders from `data`, so it fills page-by-page (1k → 2k → 3k
      // → … → 25k) instead of staying blank until the for-loop exits.
      // No-op when the caller didn't pass `progressive` — preserves the
      // legacy queryFn-only behaviour for non-list callers.
      if (progressive) {
        const partial = mapRowsToLeads(data);
        progressive.queryClient.setQueryData<Lead[]>(
          progressive.queryKey,
          partial,
        );
      }
      if (rows.length < take) break;
    }
  }

  // Final dedupe + map runs once at the end so the queryFn return value
  // matches what's already in the cache (after progressive setQueryData
  // calls during the page loop above). One log fires if the dedupe found
  // overlapping rows — a stable-tiebreaker / view-rewrite regression
  // signal.
  const beforeCount = data.length;
  const result = mapRowsToLeads(data);
  if (result.length < beforeCount) {
    logger.warn("useLeads: dropped duplicate lead rows from paginated fetch", {
      dropped: beforeCount - result.length,
    });
  }
  return result;
}

/* ── Update lead status ── */
async function updateLeadStatus(leadId: string, update: LeadStatusUpdate): Promise<void> {
  const supabase = createClient();
  const payload: Record<string, unknown> = { status: update.status };
  if (update.notes) payload.notes = update.notes;
  if (update.status === "contacted") payload.contacted_at = new Date().toISOString();
  if (update.status === "won") payload.won_at = new Date().toISOString();

  const { error } = await supabase.from("leads").update(payload).eq("id", leadId);
  if (error) throw error;
}

/* ── Hooks ── */

export function useLeads(params?: LeadQueryParams) {
  const queryClient = useQueryClient();
  const queryKey = [LEADS_KEY, params] as const;
  return useQuery({
    queryKey,
    // Move 2 — pass `progressive` so multi-page god-mode pulls write each
    // page into the cache as it lands. The dashboard's panel renders from
    // `data` directly, so 1k → 5k → 10k → 25k fills visibly while
    // `isLoading` is still true. Cheap when limit ≤ PAGE_SIZE: the
    // single-page branch ignores `progressive`.
    queryFn: () => fetchLeads(params, { queryClient, queryKey }),
    staleTime: 60_000,          // Don't refetch more than once per minute
    // refetchInterval deliberately removed — mutations invalidate on write,
    // and background polls were causing dashboard lag across multiple open
    // tabs. Users can refresh via React Query's refetch() on mount.
    refetchOnWindowFocus: false, // Avoid excessive refetches on tab switch
  });
}

export function useLeadsByStatus(statuses: LeadStatus[]) {
  return useLeads({ filters: { status: statuses } });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, update }: { leadId: string; update: LeadStatusUpdate }) =>
      updateLeadStatus(leadId, update),
    // Optimistic update: patch every cached `leads` query immediately so the
    // Kanban card jumps to the new column the instant the user drops it.
    // If the server rejects the update, onError rolls back.
    onMutate: async ({ leadId, update }) => {
      await queryClient.cancelQueries({ queryKey: [LEADS_KEY] });
      const snapshots: [readonly unknown[], unknown][] = [];
      const queries = queryClient.getQueriesData<Lead[] | undefined>({
        queryKey: [LEADS_KEY],
      });
      for (const [key, data] of queries) {
        snapshots.push([key, data]);
        if (!Array.isArray(data)) continue;
        queryClient.setQueryData<Lead[]>(key, (prev) =>
          (prev ?? []).map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  status: update.status,
                  ...(update.status === "contacted" && !l.contacted_at
                    ? { contacted_at: new Date().toISOString() }
                    : {}),
                  ...(update.status === "won" && !l.won_at
                    ? { won_at: new Date().toISOString() }
                    : {}),
                }
              : l,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      // Roll back to the pre-mutation cache.
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      // Revalidate after the server confirms so our optimistic patch matches
      // any server-side computed fields (e.g., updated_at triggers).
      queryClient.invalidateQueries({ queryKey: [LEADS_KEY] });
    },
  });
}

export function useAddLeadNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, note }: { leadId: string; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("leads").update({ notes: note }).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEADS_KEY] });
    },
  });
}
