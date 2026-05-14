/**
 * Input/output shapes for the intent classifier.
 *
 * Module 1 of the 18-module enhancement plan. The classifier is a pure
 * function over a denormalized "row context" — it doesn't fetch from
 * Supabase. Callers (score cron, backfill script, intake handler) pull
 * the row + joined data and pass it in.
 */

import type { OpportunityStage } from "./reason-codes";

/**
 * The minimum context needed to classify a row. All fields nullable so
 * the same shape works for permits-only rows, intakes-only rows, and
 * fully-enriched leads.
 */
export interface ClassifyInput {
  // ─── Origin signals ──────────────────────────────────────────────
  /** True when this row was created from a homeowner intake submission. */
  is_homeowner_intake?: boolean | null;
  /** When the homeowner-intake row exists, current intake status. */
  intake_status?: string | null;
  /** Did the homeowner explicitly grant consent? Drives stage promotion. */
  intake_consent_given?: boolean | null;

  // ─── Permit lifecycle ────────────────────────────────────────────
  permit_status?: string | null;          // submitted | approved | issued | final | expired | revoked
  permit_type?: string | null;
  permit_description?: string | null;
  permit_value?: number | null;            // dollars
  /** Days since the permit was filed (issued_date / applied_date / created_at). */
  permit_age_days?: number | null;
  /** Days since the permit was finalised (completed). Null if not finalised. */
  days_since_completion?: number | null;

  // ─── Contractor / applicant ──────────────────────────────────────
  contractor_name?: string | null;
  applicant_name?: string | null;
  applicant_classification?: string | null; // homeowner | contractor | spec

  // ─── Property signals ────────────────────────────────────────────
  year_built?: number | null;
  lot_sqft?: number | string | null;
  home_sqft?: number | string | null;
  assessed_value?: number | null;
  property_value?: number | null;
  /** Days since the most recent recorded sale (parcels_sidecar.last_sale_dt). */
  days_since_sale?: number | null;
  owner_occupied?: boolean | null;
  /** Mailing address — used for absentee detection. */
  mailing_address?: string | null;
  situs_address?: string | null;
  /** Common owner-name patterns suggest investor / LLC ownership. */
  owner_name?: string | null;

  // ─── Cascade / history ───────────────────────────────────────────
  cascade_count?: number | null;
  permit_history?: string[] | null;

  // ─── Sidecar event proximity (booleans pre-computed by caller) ───
  has_recent_disaster?: boolean | null;
  has_open_code_violation?: boolean | null;

  // ─── ZIP-level aggregates ────────────────────────────────────────
  zip_adu_permits_90d?: number | null;
  zip_remodel_permits_90d?: number | null;
  zip_neighbor_upgrade_trend?: boolean | null;

  // ─── Misc ────────────────────────────────────────────────────────
  /** When the lead has a phone we can call. */
  phone?: string | null;
  email?: string | null;
}

export interface ClassifyOutput {
  stage: OpportunityStage | null;
  /** Deduplicated reason codes ordered by importance. Top 3 are surfaced
   *  in the drawer chip tooltip. */
  reason_codes: string[];
  /** Trade tags inferred from description + permit_type. Richer than the
   *  existing `trade` enum. */
  trade_tags: string[];
}
