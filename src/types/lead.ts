/* ── Shared lead types used across Dashboard, Pipeline, Intel, Outreach, etc. ── */

export type LeadUrgency = "hot" | "warm" | "cool" | "cold";
export type LeadStatus = "new" | "contacted" | "quoted" | "proposal" | "won" | "lost" | "archived";

export interface Lead {
  id: string;
  permit_id: string;
  contractor_id: string;

  /* Core scoring */
  score: number;
  urgency: LeadUrgency;
  status: LeadStatus;
  score_reasoning?: string | null;
  score_model?: string | null;

  /* Score breakdown (6 components) */
  score_freshness: number;
  score_value: number;
  score_contact: number;
  score_demand: number;
  score_engagement?: number;
  score_conversion?: number;
  /** Phase 0a: structured breakdown for the transparency drawer. Nullable
   * so pre-migration rows are still valid. Shape is verified at render
   * via `isScoreSignalBreakdown()` to defend against legacy jsonb. */
  score_signals?: unknown;

  /* Property */
  address: string;
  city?: string;
  state?: string;
  zip: string;
  latitude?: number | null;
  longitude?: number | null;
  property_value?: number | null;
  assessed_value?: number | null;
  year_built?: number | null;
  lot_sqft?: string | null;
  home_sqft?: string | null;

  /* Owner */
  owner_name?: string | null;
  owner_first?: string | null;
  owner_last?: string | null;
  co_owner?: string | null;
  owner_since?: string | null;
  owner_occupied?: boolean;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  email2?: string | null;
  mailing_address?: string | null;

  /* Permit info */
  permit_type?: string | null;
  permit_description?: string | null;
  permit_value?: number | null;
  permit_filed_date?: string | null;
  permit_age_days?: number | null;
  trade?: string | null;
  pipeline_value?: number | null;

  /* Cascade */
  cascade_flag: boolean;
  cascade_count: number;
  permit_history?: string[];

  /* Provenance (migration 00039) */
  contact_source?: string | null;
  contact_confidence?: number | null;

  /* Apollo / business enrichment (migration 00044) */
  employer?: string | null;
  occupation?: string | null;
  business_phone?: string | null;
  business_status?: string | null;
  business_website?: string | null;
  license_number?: string | null;
  license_status?: string | null;
  naics_code?: string | null;

  /* Predictive cross-trade engine (migration 00045). jsonb array;
   * shape verified at the call site before render. */
  cross_trade_suggestions?: unknown;

  /* PostgREST embed via SELECT_NARROW / SELECT_WIDE — present whenever
   * useLeads runs without `skip_permits_join`. Fields mirror the
   * PERMITS_JOIN constant in src/hooks/useLeads.helpers.ts. */
  permits?: {
    id?: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    permit_type?: string | null;
    description?: string | null;
    status?: string | null;
    estimated_value?: number | null;
    applied_date?: string | null;
    issued_date?: string | null;
    completed_date?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    applicant_name?: string | null;
    contractor_name?: string | null;
  } | null;

  /* Meta */
  notes?: string | null;
  contacted_at?: string | null;
  won_at?: string | null;
  is_homeowner_intake?: boolean;
  created_at: string;
  updated_at: string;
}

/* ── Filter / sort params for API calls ── */
export interface LeadFilters {
  urgency?: LeadUrgency;
  status?: LeadStatus | LeadStatus[];
  trade?: string;
  zip?: string;
  cascade_only?: boolean;
  homeowner_only?: boolean;
  /** When true, only return leads whose joined permit has lat+lng. Useful
   * for the dashboard map so the pin count matches the panel count. */
  geocoded_only?: boolean;
  min_score?: number;
  max_score?: number;
  search?: string;
}

export type LeadSortField = "score" | "created_at" | "permit_age_days" | "pipeline_value";
export type LeadSortDir = "asc" | "desc";

export interface LeadQueryParams {
  filters?: LeadFilters;
  sort_by?: LeadSortField;
  sort_dir?: LeadSortDir;
  page?: number;
  limit?: number;
  /** When true, skip ORDER BY on the Supabase query. Useful when combined
   * with `filters.geocoded_only` so the planner can use the latitude index
   * without being forced into a score-sort scan (23× speedup on 100k+ leads). */
  skip_sort?: boolean;
  /** When true, omit the heavy `permits(...)` embed from the SELECT and
   * read the denormalized permit fields off `leads` instead (migration
   * 00019: address, city, state, zip, permit_type, permit_value). Enables
   * god-mode pulls past the 3,000-row Supabase statement-timeout ceiling.
   * Heavier permit fields (description, applicant_name, dates) load on
   * demand via `usePermitDetail` when the drawer opens. */
  skip_permits_join?: boolean;
}

/* ── Mutation payloads ── */
export interface LeadStatusUpdate {
  status: LeadStatus;
  notes?: string;
  loss_reason?: string;
}

/* ── Helper to derive urgency label from score ── */
export function getUrgency(score: number): LeadUrgency {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cool";
  return "cold";
}

export function getUrgencyColor(urgency: LeadUrgency): string {
  switch (urgency) {
    case "hot": return "#D4886A";
    case "warm": return "#D4A24A";
    case "cool": return "#7BA4C7";
    case "cold": return "#4A7FC0";
  }
}

export function getUrgencyLabel(urgency: LeadUrgency): string {
  switch (urgency) {
    case "hot": return "Hot Lead";
    case "warm": return "Warm Lead";
    case "cool": return "Cool Lead";
    case "cold": return "Cold Lead";
  }
}

export function formatCurrency(cents: number | null | undefined): string {
  if (!cents) return "$0";
  if (cents >= 1_000_000) return `$${(cents / 1_000_000).toFixed(1)}M`;
  if (cents >= 1_000) return `$${Math.round(cents / 1_000)}K`;
  return `$${cents}`;
}
