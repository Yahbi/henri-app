/**
 * Intent classifier — composer.
 *
 * Module 1 of the 18-module enhancement plan (2026-05-09 plan §9.1).
 *
 * Pure function: input row → { stage, reason_codes, trade_tags }.
 * No I/O. Deterministic. Heavily unit-tested.
 *
 * Stage selection rules (first match wins, top → bottom):
 *
 *   1. is_homeowner_intake → homeowner_submitted (or active_intent for
 *      partially-filled intakes).
 *   2. permit_status='expired' or 'revoked' → expired.
 *   3. permit_status='submitted'/'in_review' AND age >90d → stalled.
 *   4. permit_status='final' AND days_since_completion ≥ 5y → maintenance_upsell.
 *   5. permit_status='final' → completed.
 *   6. permit_status='approved'/'issued' AND has inspection_scheduled → project_moving.
 *   7. permit_status='approved'/'issued' AND contractor_name → permit_filed_with_contractor.
 *   8. permit_status='approved'/'issued' AND no contractor → permit_filed_no_contractor.
 *   9. permit_status='submitted' or 'in_review' → active_intent.
 *  10. ≥3 pre-intent reason codes AND no permit → pre_intent.
 *  11. otherwise → null (uncategorised).
 */

import type { ClassifyInput, ClassifyOutput } from "./types";
import type { OpportunityStage } from "./reason-codes";
import {
  deriveAgeReasons,
  derivePropertyReasons,
  deriveOwnershipReasons,
  deriveNeighborhoodReasons,
  deriveHomeownerReasons,
  derivePermitReasons,
  deriveMaintenanceReasons,
  deriveHistoryReasons,
  deriveTradeTags,
} from "./derive";

const PRE_INTENT_CATEGORY_CODES = new Set<string>([
  "old_property",
  "old_roof_estimate",
  "old_water_heater_estimate",
  "old_hvac_estimate",
  "old_electrical_panel",
  "lot_supports_adu",
  "large_lot_small_structure",
  "underbuilt_vs_neighbors",
  "garage_conversion_potential",
  "absentee_owner",
  "investor_owner",
  "recent_home_sale",
  "high_equity_proxy",
  "high_property_value",
  "nearby_adu_activity_90d",
  "nearby_remodel_activity_90d",
  "neighborhood_upgrade_trend",
  "nearby_disaster_event",
  "code_violation_open",
]);

function pickStage(input: ClassifyInput, codes: Set<string>): OpportunityStage | null {
  const status = (input.permit_status ?? "").toLowerCase();
  const ageDays = input.permit_age_days;
  const sinceCompletion = input.days_since_completion;

  // 1. Homeowner-submitted intake takes precedence over permit lifecycle.
  if (input.is_homeowner_intake) {
    const intake = (input.intake_status ?? "").toLowerCase();
    if (intake === "withdrawn" || intake === "archived") return "archived";
    if (intake === "" || intake === "draft" || intake === "submitting") return "active_intent";
    return "homeowner_submitted";
  }

  // 2. Expired / revoked.
  if (status === "expired" || status === "revoked") return "expired";

  // 3. Stalled (submitted long ago, never approved).
  if ((status === "submitted" || status === "in_review") && ageDays != null && ageDays > 90) {
    return "stalled";
  }

  // 4 + 5. Final / completed permits.
  if (status === "final" || status === "completed") {
    if (sinceCompletion != null && sinceCompletion >= 365 * 5) return "maintenance_upsell";
    return "completed";
  }

  // 6 + 7 + 8. Approved / issued.
  if (status === "approved" || status === "issued") {
    if (codes.has("inspection_scheduled") || codes.has("inspection_failed")) {
      return "project_moving";
    }
    if (input.contractor_name && input.contractor_name.trim().length > 0) {
      return "permit_filed_with_contractor";
    }
    return "permit_filed_no_contractor";
  }

  // 9. Submitted but recent → active intent.
  if (status === "submitted" || status === "in_review" || status === "pre_application") {
    return "active_intent";
  }

  // 10. Strong pre-intent signals.
  let preIntentCount = 0;
  for (const c of codes) if (PRE_INTENT_CATEGORY_CODES.has(c)) preIntentCount++;
  if (preIntentCount >= 3 && !status) return "pre_intent";

  return null;
}

/**
 * Order reason codes by importance for drawer rendering. Top 3 get
 * surfaced as the chip tooltip "Why this matters today" line.
 *
 * Priority groups (high → low):
 *   1. Stage-defining permit codes (filed_today, expired, stalled)
 *   2. Buyer-type / opportunity codes (subcontractor, supplier, expediter)
 *   3. Active-intent homeowner codes
 *   4. Strong pre-intent signals (recent_home_sale, old_property)
 *   5. Generic property / history codes
 */
const PRIORITY_ORDER: string[] = [
  // Group 1 — stage-defining
  "permit_filed_today",
  "permit_filed_no_contractor",
  "permit_expired",
  "stalled_permit",
  "permit_aging_30d",
  "homeowner_submitted_request",
  "homeowner_match_requested",
  "homeowner_quotes_requested",
  // Group 2 — buyer-type
  "subcontractor_opportunity",
  "supplier_opportunity",
  "expediter_opportunity",
  "replacement_cycle_due",
  "warranty_expired",
  "completed_solar_no_battery",
  "completed_adu_needs_landscaping",
  "contractor_listed_high_value",
  "large_project",
  "high_project_valuation",
  // Group 3 — active intent
  "homeowner_phone_verified",
  "homeowner_email_verified",
  "homeowner_timeline_under_30d",
  "homeowner_budget_provided",
  "plan_check_correction",
  "correction_notice",
  "inspection_failed",
  "code_violation_open",
  // Group 4 — pre-intent property
  "recent_home_sale",
  "old_property",
  "old_roof_estimate",
  "old_hvac_estimate",
  "old_water_heater_estimate",
  "old_electrical_panel",
  "lot_supports_adu",
  "high_equity_proxy",
  "absentee_owner",
  "investor_owner",
  "nearby_adu_activity_90d",
  "nearby_remodel_activity_90d",
  "nearby_disaster_event",
  // Group 5 — history / scope
  "cascade_count_high",
  "multi_trade_scope",
  "roofing_scope",
  "hvac_scope",
  "kitchen_bath_scope",
  "electrical_panel_scope",
  "plumbing_scope",
];

function orderCodes(codes: Set<string>): string[] {
  const ordered: string[] = [];
  for (const c of PRIORITY_ORDER) {
    if (codes.has(c)) ordered.push(c);
  }
  // Append any leftovers in their natural order.
  for (const c of codes) {
    if (!ordered.includes(c)) ordered.push(c);
  }
  return ordered;
}

export function classify(input: ClassifyInput): ClassifyOutput {
  const codes = new Set<string>();

  // Run every derivation. Each returns 0..N codes; we union them.
  for (const c of deriveAgeReasons(input)) codes.add(c);
  for (const c of derivePropertyReasons(input)) codes.add(c);
  for (const c of deriveOwnershipReasons(input)) codes.add(c);
  for (const c of deriveNeighborhoodReasons(input)) codes.add(c);
  for (const c of deriveHomeownerReasons(input)) codes.add(c);
  for (const c of derivePermitReasons(input)) codes.add(c);
  for (const c of deriveMaintenanceReasons(input)) codes.add(c);
  for (const c of deriveHistoryReasons(input)) codes.add(c);

  const stage = pickStage(input, codes);
  const trade_tags = deriveTradeTags(input);

  return {
    stage,
    reason_codes: orderCodes(codes),
    trade_tags,
  };
}
