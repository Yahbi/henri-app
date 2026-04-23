"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Lead, LeadQueryParams, LeadStatusUpdate, LeadStatus } from "@/types/lead";

const LEADS_KEY = "leads";

/* ── Fetch leads from Supabase ── */
async function fetchLeads(params?: LeadQueryParams): Promise<Lead[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Unauthenticated: return empty. Middleware redirects to /login for any
  // dashboard route, so this branch should not actually render. Deliberately
  // NOT falling back to mock/demo/Socrata — the authenticated app always
  // shows the user's own Supabase data, never placeholder content.
  if (!user) return [];

  let query = supabase
    .from("leads")
    .select(`
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
      permits (
        id, address, city, state, zip,
        permit_type, description, status,
        estimated_value, applied_date, issued_date, completed_date,
        latitude, longitude
      )
    `)
    .eq("contractor_id", user.id);

  const f = params?.filters;
  if (f?.urgency) query = query.eq("urgency", f.urgency);
  if (f?.status) {
    if (Array.isArray(f.status)) query = query.in("status", f.status);
    else query = query.eq("status", f.status);
  }
  if (f?.trade) query = query.eq("trade", f.trade);
  if (f?.cascade_only) query = query.eq("cascade_flag", true);
  if (f?.geocoded_only) {
    // Filter on leads.latitude (denormalized in migration 00019, index-backed)
    // — NOT on permits.latitude via the join. Nested-join not-null filters
    // can't use the permits index and trigger a Supabase statement timeout
    // on large data sets.
    query = query.not("latitude", "is", null).not("longitude", "is", null);
  }
  if (f?.min_score) query = query.gte("score", f.min_score);
  if (f?.max_score) query = query.lte("score", f.max_score);

  const sortBy = params?.sort_by ?? "score";
  const sortDir = params?.sort_dir ?? "desc";
  const skipSort = params?.skip_sort === true;
  if (!skipSort) {
    query = query.order(sortBy, { ascending: sortDir === "asc" });
  }

  const limit = params?.limit ?? 50;
  const page = params?.page ?? 0;
  const startOffset = page * limit;

  // Supabase PostgREST caps every response at 1000 rows regardless of the
  // requested limit. When the caller asks for more (god-mode users fetching
  // up to 5,000 leads), paginate with .range() until we hit the requested
  // count or the result set runs out.
  const PAGE_SIZE = 1000;
  type Row = Record<string, unknown>;
  let data: Row[] = [];
  if (limit <= PAGE_SIZE) {
    const { data: rows, error } = await query.range(
      startOffset,
      startOffset + limit - 1,
    );
    if (error) throw error;
    data = rows ?? [];
  } else {
    for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
      const take = Math.min(PAGE_SIZE, limit - offset);
      // Must rebuild the query per page — Supabase query builders are
      // single-use once .range() is applied.
      let pageQuery = supabase
        .from("leads")
        .select(`
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
          permits (
            address, city, state, zip,
            permit_type, description,
            estimated_value, applied_date,
            latitude, longitude
          )
        `)
        .eq("contractor_id", user.id);
      if (f?.urgency) pageQuery = pageQuery.eq("urgency", f.urgency);
      if (f?.status) {
        if (Array.isArray(f.status)) pageQuery = pageQuery.in("status", f.status);
        else pageQuery = pageQuery.eq("status", f.status);
      }
      if (f?.trade) pageQuery = pageQuery.eq("trade", f.trade);
      if (f?.cascade_only) pageQuery = pageQuery.eq("cascade_flag", true);
      if (f?.geocoded_only) {
        pageQuery = pageQuery
          .not("latitude", "is", null)
          .not("longitude", "is", null);
      }
      if (f?.min_score) pageQuery = pageQuery.gte("score", f.min_score);
      if (f?.max_score) pageQuery = pageQuery.lte("score", f.max_score);
      if (!skipSort) {
        pageQuery = pageQuery.order(sortBy, { ascending: sortDir === "asc" });
      }
      const { data: rows, error } = await pageQuery.range(
        startOffset + offset,
        startOffset + offset + take - 1,
      );
      if (error) {
        // Partial-result tolerance for god-mode fetches of 20k+ leads: if a
        // later page hits the Supabase statement timeout, return what we have
        // rather than throwing and showing an empty panel.
        console.warn(
          `useLeads: page at offset ${startOffset + offset} failed (${error.message}); returning ${data.length} rows collected so far`,
        );
        break;
      }
      if (!rows || rows.length === 0) break;
      data.push(...(rows as Row[]));
      if (rows.length < take) break;
    }
  }

  return data.map((row: Record<string, unknown>) => {
    const permit = row.permits as Record<string, unknown> | null;
    return {
      ...row,
      address: permit?.address ?? row.mailing_address ?? "Unknown",
      city: permit?.city,
      state: permit?.state,
      zip: permit?.zip ?? "",
      permit_type: permit?.permit_type,
      permit_description: permit?.description,
      permit_value: permit?.estimated_value,
      permit_filed_date: permit?.applied_date,
      permit_age_days: permit?.applied_date
        ? Math.floor((Date.now() - new Date(permit.applied_date as string).getTime()) / 86400000)
        : null,
      // Prefer the denormalized leads.latitude/longitude (scorer writes these
      // when creating the lead; they're what the geocoded_only filter keys
      // on). Fall back to the joined permit row if the denorm is missing.
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
  return useQuery({
    queryKey: [LEADS_KEY, params],
    queryFn: () => fetchLeads(params),
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
