/**
 * Reason-code derivation helpers.
 *
 * Each function inspects the ClassifyInput and returns 0..N reason codes.
 * Pure, deterministic, no I/O. Composed by classify.ts.
 *
 * Module 1 of the 18-module enhancement plan.
 */

import type { ClassifyInput } from "./types";

/** Coerce a possibly-string sqft / count into a number, returning null
 *  when unparseable. Matches CLAUDE.md "graceful degrade" pattern — sparse
 *  fields shouldn't crash the classifier. */
function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[, $]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Year heuristic — current year minus N. Lets tests pin behavior to a
 *  fixed reference year via injection. */
function currentYear(): number {
  return new Date().getFullYear();
}

/** Common investor / LLC name patterns. Conservative — we'd rather miss
 *  some investor owners than mislabel a person. */
const INVESTOR_PATTERNS = [
  /\bllc\b/i,
  /\binc\b/i,
  /\bcorp\b/i,
  /\bholdings?\b/i,
  /\binvest(or|ment)\b/i,
  /\btrust\b/i,
  /\bproperties\b/i,
  /\b(real\s*estate|realty)\b/i,
];

/** ─── Pre-intent (Stage 1) derivations ───────────────────────────── */

export function deriveAgeReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  const yr = input.year_built;
  if (yr == null) return codes;

  const age = currentYear() - yr;
  if (age >= 30) {
    codes.push("old_property");
    // Trade-specific age proxies — when no permit exists for that trade,
    // assume the system is original-spec.
    const history = (input.permit_history ?? []).join(" ").toLowerCase();
    if (age >= 20 && !/(roof|reroof)/i.test(history)) {
      codes.push("old_roof_estimate");
    }
    if (age >= 15 && !/(hvac|mechanical|furnace|ac)/i.test(history)) {
      codes.push("old_hvac_estimate");
    }
    if (age >= 12 && !/(plumb|water heater|wh)/i.test(history)) {
      codes.push("old_water_heater_estimate");
    }
    if (yr < 2000 && !/(electrical|panel|service)/i.test(history)) {
      codes.push("old_electrical_panel");
    }
  }
  return codes;
}

export function derivePropertyReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  const lot = asNumber(input.lot_sqft);
  const home = asNumber(input.home_sqft);

  if (lot != null && lot >= 6000) codes.push("lot_supports_adu");
  if (lot != null && home != null && lot > 0 && home / lot < 0.25) {
    codes.push("large_lot_small_structure");
    codes.push("underbuilt_vs_neighbors");
  }
  if (home != null && lot != null && lot > 4000 && home < 1500) {
    codes.push("garage_conversion_potential");
  }
  return codes;
}

export function deriveOwnershipReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];

  // Absentee owner — mailing != situs (uses pre-computed boolean OR
  // string-equality fallback).
  if (input.owner_occupied === false) {
    codes.push("absentee_owner");
  } else if (input.mailing_address && input.situs_address) {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (norm(input.mailing_address) !== norm(input.situs_address)) {
      codes.push("absentee_owner");
    }
  }

  // Investor / LLC owner-name patterns.
  if (input.owner_name && INVESTOR_PATTERNS.some((re) => re.test(input.owner_name!))) {
    codes.push("investor_owner");
  }

  // Recent home sale — within last 12 months.
  if (input.days_since_sale != null && input.days_since_sale <= 365) {
    codes.push("recent_home_sale");
  }

  // High equity proxy — assessed materially below market.
  const assessed = asNumber(input.assessed_value);
  const market = asNumber(input.property_value);
  if (assessed != null && market != null && market > 0) {
    const equityPct = (market - assessed) / market;
    if (equityPct >= 0.30) codes.push("high_equity_proxy");
  }
  if (market != null && market >= 1_000_000) {
    codes.push("high_property_value");
  }
  return codes;
}

export function deriveNeighborhoodReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  if (input.zip_adu_permits_90d != null && input.zip_adu_permits_90d >= 3) {
    codes.push("nearby_adu_activity_90d");
  }
  if (input.zip_remodel_permits_90d != null && input.zip_remodel_permits_90d >= 5) {
    codes.push("nearby_remodel_activity_90d");
  }
  if (input.zip_neighbor_upgrade_trend) {
    codes.push("neighborhood_upgrade_trend");
  }
  if (input.has_recent_disaster) {
    codes.push("nearby_disaster_event");
  }
  if (input.has_open_code_violation) {
    codes.push("code_violation_open");
  }
  return codes;
}

/** ─── Active intent (Stage 2) derivations ────────────────────────── */

export function deriveHomeownerReasons(input: ClassifyInput): string[] {
  if (!input.is_homeowner_intake) return [];
  const codes: string[] = ["homeowner_submitted_request", "homeowner_address_entered"];

  if (input.phone) codes.push("homeowner_phone_verified");
  if (input.email) codes.push("homeowner_email_verified");

  return codes;
}

/** ─── Permit / project-moving (Stage 3) derivations ──────────────── */

export function derivePermitReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  const status = (input.permit_status ?? "").toLowerCase();
  const ageDays = input.permit_age_days;

  // Status-driven codes
  if (status === "expired" || status === "revoked") {
    codes.push("permit_expired", "expediter_opportunity");
  }
  if ((status === "submitted" || status === "in_review") && ageDays != null && ageDays > 90) {
    codes.push("stalled_permit", "expediter_opportunity");
  }
  if (status === "approved" || status === "issued") {
    codes.push("permit_filed");
    if (ageDays != null && ageDays <= 1) codes.push("permit_filed_today");
    else if (ageDays != null && ageDays >= 14 && ageDays <= 30) codes.push("permit_aging_30d");

    if (input.contractor_name && input.contractor_name.trim().length > 0) {
      codes.push("contractor_listed");
      const value = asNumber(input.permit_value);
      if (value != null && value >= 50_000) {
        codes.push("contractor_listed_high_value");
        codes.push("subcontractor_opportunity");
      }
      if (value != null && value >= 250_000) {
        codes.push("supplier_opportunity", "large_project");
      }
    } else {
      codes.push("permit_filed_no_contractor");
    }
  }

  // Description-based scope codes (description-miner already extracts
  // these; we add the canonical reason-code form here).
  const desc = (input.permit_description ?? "").toLowerCase();
  if (/roof/.test(desc)) codes.push("roofing_scope");
  if (/(kitchen|bath)/.test(desc)) codes.push("kitchen_bath_scope");
  if (/(electrical|panel|service)/.test(desc)) codes.push("electrical_panel_scope");
  if (/(plumb|water heater|sewer)/.test(desc)) codes.push("plumbing_scope");
  if (/(hvac|furnace|mechanical|air condition)/.test(desc)) codes.push("hvac_scope");

  // Multi-trade scope = description contains 3+ trade keywords
  const tradeHits = ["roof", "kitchen", "bath", "electrical", "plumb", "hvac", "mechanical"]
    .filter((k) => desc.includes(k)).length;
  if (tradeHits >= 3) codes.push("multi_trade_scope");

  // High project valuation
  const v = asNumber(input.permit_value);
  if (v != null && v >= 100_000) codes.push("high_project_valuation");

  return codes;
}

/** ─── Maintenance / upsell (Stage 4) derivations ─────────────────── */

export function deriveMaintenanceReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  const status = (input.permit_status ?? "").toLowerCase();
  if (status !== "final" && status !== "completed") return codes;

  const since = input.days_since_completion;
  if (since != null && since >= 365 * 5) {
    codes.push("old_completed_project", "warranty_expired", "replacement_cycle_due");
  }

  const desc = (input.permit_description ?? "").toLowerCase();
  if (/solar/.test(desc) && !/battery|storage/.test(desc)) {
    codes.push("completed_solar_no_battery");
  }
  if (/adu/.test(desc) || /accessory dwelling/.test(desc)) {
    codes.push("completed_adu_needs_landscaping");
  }
  if (/(remodel|renovation)/.test(desc)) {
    codes.push("completed_remodel_needs_maintenance");
  }
  return codes;
}

/** ─── Cross-cutting derivations ──────────────────────────────────── */

export function deriveHistoryReasons(input: ClassifyInput): string[] {
  const codes: string[] = [];
  const cc = input.cascade_count ?? 0;
  if (cc >= 2) codes.push("cascade_count_high");
  return codes;
}

/** ─── Trade-tag inference (richer than existing trade enum) ──────── */

const TRADE_KEYWORDS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "adu", pattern: /\b(adu|accessory\s*dwelling)\b/i },
  { tag: "remodel", pattern: /\b(remodel|renovation)\b/i },
  { tag: "kitchen", pattern: /\bkitchen\b/i },
  { tag: "bath", pattern: /\b(bath|bathroom|shower)\b/i },
  { tag: "roofing", pattern: /\b(roof|reroof)\b/i },
  { tag: "hvac", pattern: /\b(hvac|furnace|air\s*condition|mechanical)\b/i },
  { tag: "plumbing", pattern: /\b(plumb|water\s*heater)\b/i },
  { tag: "sewer", pattern: /\bsewer\b/i },
  { tag: "electrical", pattern: /\b(electrical|panel|service\s*upgrade)\b/i },
  { tag: "solar", pattern: /\bsolar\b/i },
  { tag: "flooring", pattern: /\b(flooring|hardwood|tile)\b/i },
  { tag: "landscaping", pattern: /\b(landscap|fence|fencing|hardscape)\b/i },
  { tag: "concrete", pattern: /\bconcrete\b/i },
  { tag: "windows", pattern: /\bwindow/i },
  { tag: "foundation", pattern: /\bfoundation\b/i },
  { tag: "pool", pattern: /\bpool\b/i },
  { tag: "garage_conversion", pattern: /garage\s*(convers|to)/i },
  { tag: "general_construction", pattern: /\b(addition|new\s*construction)\b/i },
];

export function deriveTradeTags(input: ClassifyInput): string[] {
  const text = [input.permit_description, input.permit_type].filter(Boolean).join(" ").toLowerCase();
  if (!text) return [];
  const tags = new Set<string>();
  for (const { tag, pattern } of TRADE_KEYWORDS) {
    if (pattern.test(text)) tags.add(tag);
  }
  return Array.from(tags);
}
