/**
 * Reason-code library for the intent classifier.
 *
 * Module 1 of the 18-module enhancement plan (2026-05-09 plan §9.1).
 * Each code maps to:
 *   - `label`: short human title rendered as a chip
 *   - `description`: one-line plain-English explanation rendered in the
 *                    drawer tooltip + outreach context
 *   - `stage_hint`: which `opportunity_stage` this code typically implies
 *                   (the classifier picks the dominant stage; multiple
 *                   codes can vote for different stages)
 *   - `category`: pre_intent | active_intent | permit | maintenance |
 *                  buyer_type | property_signal — used for grouping in
 *                  the drawer tooltip
 *
 * Codes are stable text constants. Adding a new code is O(1) — append a
 * row here, emit it from a derive function. No migration needed.
 *
 * Counts (2026-05-09): 25 pre-intent · 20 active-intent · 10 permit ·
 * 10 maintenance · 4 buyer-type derivations = 69 codes.
 */

export type OpportunityStage =
  | "pre_intent"
  | "active_intent"
  | "homeowner_submitted"
  | "permit_filed_no_contractor"
  | "permit_filed_with_contractor"
  | "project_moving"
  | "stalled"
  | "expired"
  | "completed"
  | "maintenance_upsell"
  | "archived";

export const ALL_OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  "pre_intent",
  "active_intent",
  "homeowner_submitted",
  "permit_filed_no_contractor",
  "permit_filed_with_contractor",
  "project_moving",
  "stalled",
  "expired",
  "completed",
  "maintenance_upsell",
  "archived",
] as const;

export type ReasonCategory =
  | "pre_intent"
  | "active_intent"
  | "permit"
  | "maintenance"
  | "buyer_type"
  | "property_signal";

export interface ReasonCodeDef {
  code: string;
  label: string;
  description: string;
  stage_hint: OpportunityStage | null;
  category: ReasonCategory;
}

export const REASON_CODES: Record<string, ReasonCodeDef> = {
  // ─── Stage 1 — pre-intent / before-intent (25) ───────────────────────
  old_property: {
    code: "old_property",
    label: "Old property",
    description: "Built more than 30 years ago — likely overdue for major systems work.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  old_roof_estimate: {
    code: "old_roof_estimate",
    label: "Aging roof",
    description: "Roof estimated >20 years old; no roofing permit on file in 25 years.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  old_water_heater_estimate: {
    code: "old_water_heater_estimate",
    label: "Aging water heater",
    description: "No plumbing permit on file in >12 years; replacement cycle likely due.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  old_hvac_estimate: {
    code: "old_hvac_estimate",
    label: "Aging HVAC",
    description: "No mechanical permit on file in >15 years; HVAC may be near end of life.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  old_electrical_panel: {
    code: "old_electrical_panel",
    label: "Old electrical panel",
    description: "Pre-2000 build, no electrical permit on file — panel likely undersized.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  lot_supports_adu: {
    code: "lot_supports_adu",
    label: "Large lot — ADU candidate",
    description: "Lot >6,000 sqft and home <50% of lot — physically supports ADU.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  adu_friendly_zoning: {
    code: "adu_friendly_zoning",
    label: "ADU-friendly zoning",
    description: "Local zoning permits ADUs by-right.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  nearby_adu_activity_90d: {
    code: "nearby_adu_activity_90d",
    label: "Nearby ADU activity",
    description: "≥3 ADU permits in same ZIP in the last 90 days — neighborhood trend.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  nearby_remodel_activity_90d: {
    code: "nearby_remodel_activity_90d",
    label: "Nearby remodel activity",
    description: "Elevated remodel permit volume in same ZIP recently.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  high_equity_proxy: {
    code: "high_equity_proxy",
    label: "High equity proxy",
    description: "Market value materially above assessed value — owner has tappable equity.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  high_property_value: {
    code: "high_property_value",
    label: "High-value property",
    description: "Property value above ZIP median — supports premium project budget.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  recent_home_sale: {
    code: "recent_home_sale",
    label: "Recently purchased",
    description: "Sold within the last 12 months — new owners often renovate within 18 months.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  absentee_owner: {
    code: "absentee_owner",
    label: "Absentee owner",
    description: "Mailing address ≠ situs — owner does not live at the property.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  investor_owner: {
    code: "investor_owner",
    label: "Investor-owned",
    description: "Owner name matches investor / LLC patterns.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  multifamily_property: {
    code: "multifamily_property",
    label: "Multifamily property",
    description: "Land use indicates 2+ unit residential property.",
    stage_hint: "pre_intent",
    category: "property_signal",
  },
  code_violation_open: {
    code: "code_violation_open",
    label: "Open code violation",
    description: "Active code-enforcement violation on file — work likely required to clear.",
    stage_hint: "active_intent",
    category: "pre_intent",
  },
  nearby_disaster_event: {
    code: "nearby_disaster_event",
    label: "Recent disaster event",
    description: "Storm, flood, fire, or quake event within 25mi in the last 90 days.",
    stage_hint: "active_intent",
    category: "pre_intent",
  },
  solar_potential_high: {
    code: "solar_potential_high",
    label: "High solar potential",
    description: "Roof area + orientation favors solar; no solar permit on file.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  ev_adoption_neighborhood: {
    code: "ev_adoption_neighborhood",
    label: "EV-adopting neighborhood",
    description: "Census tract shows above-average EV adoption — charger upsell candidate.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  neighborhood_upgrade_trend: {
    code: "neighborhood_upgrade_trend",
    label: "Neighborhood upgrading",
    description: "Permit volume in this ZIP rising YoY — tide of upgrades.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  underbuilt_vs_neighbors: {
    code: "underbuilt_vs_neighbors",
    label: "Underbuilt vs neighbors",
    description: "Building sqft below ZIP median — addition / expansion candidate.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  large_lot_small_structure: {
    code: "large_lot_small_structure",
    label: "Large lot, small house",
    description: "Lot:building ratio favors expansion or accessory build.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  garage_conversion_potential: {
    code: "garage_conversion_potential",
    label: "Garage conversion candidate",
    description: "Detached or oversized garage — common ADU conversion target.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  unfinished_permit_history: {
    code: "unfinished_permit_history",
    label: "Unfinished permit history",
    description: "Prior permits issued but never finalized — may need finish-out work.",
    stage_hint: "pre_intent",
    category: "pre_intent",
  },
  old_permits_maintenance_due: {
    code: "old_permits_maintenance_due",
    label: "Maintenance cycle due",
    description: "Old completed permits suggest replacement cycles approaching.",
    stage_hint: "maintenance_upsell",
    category: "pre_intent",
  },

  // ─── Stage 2 — active intent / homeowner-submitted (20) ──────────────
  homeowner_account_created: {
    code: "homeowner_account_created",
    label: "Homeowner account",
    description: "Homeowner created an account on Henri.",
    stage_hint: "active_intent",
    category: "active_intent",
  },
  homeowner_submitted_project: {
    code: "homeowner_submitted_project",
    label: "Project submitted",
    description: "Homeowner submitted a project description through the portal.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_address_entered: {
    code: "homeowner_address_entered",
    label: "Address entered",
    description: "Homeowner entered the property address.",
    stage_hint: "active_intent",
    category: "active_intent",
  },
  homeowner_trade_selected: {
    code: "homeowner_trade_selected",
    label: "Trade selected",
    description: "Homeowner selected a specific trade for the project.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_photos_uploaded: {
    code: "homeowner_photos_uploaded",
    label: "Photos uploaded",
    description: "Homeowner uploaded reference photos with the project.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_quotes_requested: {
    code: "homeowner_quotes_requested",
    label: "Quotes requested",
    description: "Homeowner explicitly requested contractor quotes.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_match_requested: {
    code: "homeowner_match_requested",
    label: "Match requested",
    description: "Homeowner asked for a contractor match.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_searched_onsite: {
    code: "homeowner_searched_onsite",
    label: "On-site search",
    description: "Homeowner searched the contractor directory.",
    stage_hint: "active_intent",
    category: "active_intent",
  },
  homeowner_estimate_saved: {
    code: "homeowner_estimate_saved",
    label: "Estimate saved",
    description: "Homeowner saved a project estimate.",
    stage_hint: "active_intent",
    category: "active_intent",
  },
  homeowner_timeline_under_30d: {
    code: "homeowner_timeline_under_30d",
    label: "Urgent timeline",
    description: "Homeowner indicated <30 days timeline.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_budget_provided: {
    code: "homeowner_budget_provided",
    label: "Budget provided",
    description: "Homeowner shared a project budget.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_financing_interest: {
    code: "homeowner_financing_interest",
    label: "Financing interest",
    description: "Homeowner indicated interest in financing options.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_chat_questions: {
    code: "homeowner_chat_questions",
    label: "Active chat",
    description: "Homeowner asked questions through the chat intake.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_phone_verified: {
    code: "homeowner_phone_verified",
    label: "Phone verified",
    description: "Homeowner phone number verified.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  homeowner_email_verified: {
    code: "homeowner_email_verified",
    label: "Email verified",
    description: "Homeowner email verified.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },
  permit_pre_application: {
    code: "permit_pre_application",
    label: "Pre-application stage",
    description: "Permit pre-application or planning consultation on file.",
    stage_hint: "active_intent",
    category: "active_intent",
  },
  permit_filed_no_contractor: {
    code: "permit_filed_no_contractor",
    label: "Permit filed, no contractor",
    description: "Permit on file with no contractor listed — homeowner likely still hiring.",
    stage_hint: "permit_filed_no_contractor",
    category: "permit",
  },
  permit_in_early_review: {
    code: "permit_in_early_review",
    label: "Early review",
    description: "Permit in early plan-check review.",
    stage_hint: "active_intent",
    category: "permit",
  },
  plan_check_correction: {
    code: "plan_check_correction",
    label: "Plan-check correction",
    description: "Plan-check correction notice on file — expediter or design help useful.",
    stage_hint: "stalled",
    category: "permit",
  },
  correction_notice: {
    code: "correction_notice",
    label: "Correction notice",
    description: "Correction notice from inspector — may need permit-expediter work.",
    stage_hint: "stalled",
    category: "permit",
  },

  // ─── Stage 3 — permit / project moving (10) ──────────────────────────
  permit_filed: {
    code: "permit_filed",
    label: "Permit filed",
    description: "Permit on file at this address.",
    stage_hint: "permit_filed_with_contractor",
    category: "permit",
  },
  permit_filed_today: {
    code: "permit_filed_today",
    label: "Filed today",
    description: "Permit issued within the last 24 hours.",
    stage_hint: "permit_filed_no_contractor",
    category: "permit",
  },
  permit_aging_30d: {
    code: "permit_aging_30d",
    label: "Aging permit",
    description: "Permit issued 2–4 weeks ago — homeowner may still be hiring.",
    stage_hint: "permit_filed_no_contractor",
    category: "permit",
  },
  contractor_listed: {
    code: "contractor_listed",
    label: "Contractor listed",
    description: "A licensed contractor is named on the permit.",
    stage_hint: "permit_filed_with_contractor",
    category: "permit",
  },
  contractor_listed_high_value: {
    code: "contractor_listed_high_value",
    label: "GC on a big job",
    description: "Contractor listed and project valuation > $50k — subs likely needed.",
    stage_hint: "permit_filed_with_contractor",
    category: "buyer_type",
  },
  subcontractor_opportunity: {
    code: "subcontractor_opportunity",
    label: "Subcontractor opportunity",
    description: "GC is on the job; trade subs (electrical, plumbing, HVAC) likely needed.",
    stage_hint: "project_moving",
    category: "buyer_type",
  },
  supplier_opportunity: {
    code: "supplier_opportunity",
    label: "Supplier opportunity",
    description: "Large-scope new construction — material supplier opportunity.",
    stage_hint: "project_moving",
    category: "buyer_type",
  },
  inspection_scheduled: {
    code: "inspection_scheduled",
    label: "Inspection scheduled",
    description: "Inspection on the calendar — project actively moving.",
    stage_hint: "project_moving",
    category: "permit",
  },
  inspection_failed: {
    code: "inspection_failed",
    label: "Inspection failed",
    description: "Inspection failed — corrections may need expediter or specialist.",
    stage_hint: "stalled",
    category: "permit",
  },
  multi_trade_scope: {
    code: "multi_trade_scope",
    label: "Multi-trade scope",
    description: "Permit description spans multiple trades — coordination opportunity.",
    stage_hint: "permit_filed_with_contractor",
    category: "permit",
  },

  // ─── Stage 4 — maintenance / upsell (10) ─────────────────────────────
  replacement_cycle_due: {
    code: "replacement_cycle_due",
    label: "Replacement cycle due",
    description: "Original install >5 years ago — replacement window opening.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  old_completed_project: {
    code: "old_completed_project",
    label: "Old completed project",
    description: "Permit finalized 5+ years ago — maintenance opportunity.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  warranty_expired: {
    code: "warranty_expired",
    label: "Warranty expired",
    description: "Original install warranty likely lapsed — service contract upsell.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  completed_solar_no_battery: {
    code: "completed_solar_no_battery",
    label: "Solar, no battery",
    description: "Solar installed without storage — battery upsell candidate.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  completed_adu_needs_landscaping: {
    code: "completed_adu_needs_landscaping",
    label: "ADU finished — landscaping pending",
    description: "ADU completed; common follow-on: landscaping, fencing, security.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  completed_remodel_needs_maintenance: {
    code: "completed_remodel_needs_maintenance",
    label: "Remodel done — maintenance ahead",
    description: "Recently completed remodel — recurring maintenance window.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  recurring_service_due: {
    code: "recurring_service_due",
    label: "Recurring service due",
    description: "Periodic service interval likely reached.",
    stage_hint: "maintenance_upsell",
    category: "maintenance",
  },
  expediter_opportunity: {
    code: "expediter_opportunity",
    label: "Expediter opportunity",
    description: "Stalled or expired permit — expediter or design help may unblock.",
    stage_hint: "stalled",
    category: "buyer_type",
  },
  permit_expired: {
    code: "permit_expired",
    label: "Permit expired",
    description: "Permit hit its expiration date — must be renewed or refiled.",
    stage_hint: "expired",
    category: "permit",
  },
  stalled_permit: {
    code: "stalled_permit",
    label: "Stalled permit",
    description: "Filed >90 days ago and still in submitted state — momentum lost.",
    stage_hint: "stalled",
    category: "permit",
  },

  // ─── Misc cross-cutting (4) ──────────────────────────────────────────
  cascade_count_high: {
    code: "cascade_count_high",
    label: "Active renovator",
    description: "≥2 permits at this property — homeowner has a track record of work.",
    stage_hint: null,
    category: "property_signal",
  },
  high_project_valuation: {
    code: "high_project_valuation",
    label: "High project value",
    description: "Permit valuation places this in the top quartile for the trade.",
    stage_hint: null,
    category: "property_signal",
  },
  large_project: {
    code: "large_project",
    label: "Large project",
    description: "New construction or major addition with valuation > $250k.",
    stage_hint: "project_moving",
    category: "property_signal",
  },
  homeowner_submitted_request: {
    code: "homeowner_submitted_request",
    label: "Homeowner-submitted lead",
    description: "Lead originated from a homeowner intake, not a public permit.",
    stage_hint: "homeowner_submitted",
    category: "active_intent",
  },

  // ─── Trade scope codes (driven by description-miner; 5) ──────────────
  roofing_scope: {
    code: "roofing_scope",
    label: "Roofing scope",
    description: "Permit description mentions roofing work.",
    stage_hint: null,
    category: "permit",
  },
  kitchen_bath_scope: {
    code: "kitchen_bath_scope",
    label: "Kitchen / bath scope",
    description: "Permit description mentions kitchen or bathroom remodel.",
    stage_hint: null,
    category: "permit",
  },
  electrical_panel_scope: {
    code: "electrical_panel_scope",
    label: "Electrical panel scope",
    description: "Permit description mentions panel upgrade or service change.",
    stage_hint: null,
    category: "permit",
  },
  plumbing_scope: {
    code: "plumbing_scope",
    label: "Plumbing scope",
    description: "Permit description mentions plumbing work.",
    stage_hint: null,
    category: "permit",
  },
  hvac_scope: {
    code: "hvac_scope",
    label: "HVAC scope",
    description: "Permit description mentions HVAC / mechanical work.",
    stage_hint: null,
    category: "permit",
  },
} as const;

export const ALL_REASON_CODES = Object.keys(REASON_CODES);

/** Look up a code's definition. Returns null for unknown codes — safe for
 *  forward-compat (drawer renders unknown codes as the raw string). */
export function getReasonCode(code: string): ReasonCodeDef | null {
  return REASON_CODES[code] ?? null;
}

/** Render the human label for a code, falling back to a humanised
 *  version of the raw string for unknown codes. */
export function reasonCodeLabel(code: string): string {
  const def = REASON_CODES[code];
  if (def) return def.label;
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
