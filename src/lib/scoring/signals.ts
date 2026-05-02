/* ── Score-signal breakdown — Phase 0a transparency ─────────────────────── */
/*                                                                          */
/*  Typed, UI-ready breakdown of why a lead scored what it scored. Written  */
/*  into `leads.score_signals` (jsonb) alongside the legacy numeric         */
/*  columns (score_freshness / score_value / etc.), so the client can       */
/*  render the "why" without fetching the scoring engine.                   */
/*                                                                          */
/*  Design: six rows matching the six scorer components. Each row carries   */
/*  weight (max possible for that component), value (actual), and a short   */
/*  human-readable detail pulled from the scorer's `factors` list.          */

import type { ScoreResult, ScoringSignals } from "./model";

export type ScoreSignalKey =
  | "permit_freshness"
  | "permit_value"
  | "contact_completeness"
  | "zip_demand"
  | "homeowner_engagement"
  | "historical_conversion"
  /* Wave 1.5 / 2.A / 2.B additive boosters — only render when populated. */
  | "storm_proximity_24h"
  | "recent_lien_90d"
  | "nri_risk_tier"
  | "nfip_flood_history"
  | "recent_quake_50mi";

export interface ScoreSignalContribution {
  /** Stable machine key. */
  signal: ScoreSignalKey;
  /** Human-readable label for the UI. */
  label: string;
  /** Max points the signal can contribute. */
  weight: number;
  /** Points awarded on this lead. */
  value: number;
  /** One-line reason ("3 days old", "owner email present", etc.). */
  detail: string;
}

/**
 * The six signal buckets, in the order the UI should render them —
 * ordered loosely by "most actionable for a contractor first".
 */
export const SCORE_SIGNAL_ORDER: Array<{
  key: ScoreSignalKey;
  label: string;
  weight: number;
  /** Which `ScoreResult` field holds the numeric value. */
  resultKey: keyof Pick<
    ScoreResult,
    | "freshness"
    | "value"
    | "contact"
    | "demand"
    | "engagement"
    | "conversion"
    | "storm"
    | "lien"
    | "nri"
    | "nfip"
    | "quake"
  >;
  /** When true, this row only renders when the lead actually scored
   *  >0 on the signal — keeps the drawer clean for leads with no
   *  storm / lien activity nearby. */
  optional?: boolean;
}> = [
  { key: "permit_freshness",     label: "Permit freshness",       weight: 20, resultKey: "freshness" },
  { key: "permit_value",         label: "Permit value",           weight: 20, resultKey: "value" },
  { key: "contact_completeness", label: "Contact completeness",   weight: 15, resultKey: "contact" },
  { key: "zip_demand",           label: "ZIP demand",             weight: 15, resultKey: "demand" },
  { key: "homeowner_engagement", label: "Homeowner engagement",   weight: 15, resultKey: "engagement" },
  { key: "historical_conversion",label: "Historical conversion",  weight: 15, resultKey: "conversion" },
  /* Wave 1.5 / 2.A / 2.B additive boosters — render only when active. */
  { key: "storm_proximity_24h",  label: "Storm proximity (24h)",  weight: 5,  resultKey: "storm", optional: true },
  { key: "recent_lien_90d",      label: "Payment-distress nearby",weight: 3,  resultKey: "lien",  optional: true },
  { key: "nri_risk_tier",        label: "FEMA risk tier",         weight: 3,  resultKey: "nri",   optional: true },
  { key: "nfip_flood_history",   label: "NFIP flood-claim history",weight: 2, resultKey: "nfip",  optional: true },
  { key: "recent_quake_50mi",    label: "Recent earthquakes",     weight: 2,  resultKey: "quake", optional: true },
];

/**
 * Pull the first factor-string that sounds like it came from a given
 * component. Factor strings are produced by the scorer (see model.ts)
 * and not tagged, so we match heuristically on keywords. Falls back to
 * a default phrase when nothing matches — the breakdown is meant to
 * be descriptive, not forensic.
 */
function detailFor(key: ScoreSignalKey, factors: string[], signals: ScoringSignals): string {
  const find = (patterns: RegExp[]): string | null => {
    for (const f of factors) {
      if (patterns.some((re) => re.test(f))) return f;
    }
    return null;
  };

  switch (key) {
    case "permit_freshness": {
      const hit = find([/filed /i, /day[s]? ago/i, /today/i]);
      if (hit) return hit;
      const days = Math.max(0, Math.round(Math.min(signals.permitAge, signals.daysSinceCreated)));
      return days < 1 ? "Filed today" : `Filed ~${days} days ago`;
    }
    case "permit_value": {
      const hit = find([/high value|\$\d|value/i]);
      if (hit) return hit;
      if (signals.permitValue && signals.permitValue > 0) {
        return `Permit value $${signals.permitValue.toLocaleString()}`;
      }
      return "No permit value on file";
    }
    case "contact_completeness": {
      const parts: string[] = [];
      if (signals.hasPhone) parts.push("phone");
      if (signals.hasEmail) parts.push("email");
      if (signals.hasOwnerName) parts.push("owner name");
      if (parts.length === 0) return "No homeowner contact on file";
      return `${parts.join(" + ")} on file`;
    }
    case "zip_demand": {
      if (signals.zipDemandScore == null) return "ZIP demand unknown";
      return `ZIP demand score ${signals.zipDemandScore}/100 · ${signals.competitorCount} competitor${signals.competitorCount === 1 ? "" : "s"}`;
    }
    case "homeowner_engagement": {
      if (signals.isHomeownerIntake) return "Homeowner submitted an intake";
      if ((signals.cascadeCount ?? 1) > 1) return `Cascade: ${signals.cascadeCount} permits at this address`;
      if (signals.hasDescription) return "Permit description present";
      return "No direct engagement signal";
    }
    case "historical_conversion": {
      const parts: string[] = [];
      if (signals.zipConversionRate != null) {
        parts.push(`ZIP wins ${Math.round(signals.zipConversionRate * 100)}%`);
      }
      if (signals.tradeConversionRate != null) {
        parts.push(`trade wins ${Math.round(signals.tradeConversionRate * 100)}%`);
      }
      return parts.length > 0 ? parts.join(" · ") : "Not enough history yet";
    }
    case "storm_proximity_24h": {
      if (signals.stormProximity24h == null || signals.stormProximity24h <= 0) {
        return "No recent storm signature nearby";
      }
      const v = Math.round(signals.stormProximity24h);
      return `Storm signature within 25mi · 24h (intensity ${v}/100)`;
    }
    case "recent_lien_90d": {
      const n = signals.recentLienCount ?? 0;
      if (n <= 0) return "No payment-distress filings nearby";
      return `${n} mechanic-lien filing${n === 1 ? "" : "s"} nearby (90 d)`;
    }
    case "nri_risk_tier": {
      const v = signals.nriRiskScore;
      if (v == null) return "FEMA NRI not joined yet";
      if (v >= 90) return `Very High disaster risk (NRI ${Math.round(v)}/100)`;
      if (v >= 75) return `High disaster risk (NRI ${Math.round(v)}/100)`;
      if (v >= 50) return `Moderate disaster risk (NRI ${Math.round(v)}/100)`;
      return `Low disaster risk (NRI ${Math.round(v)}/100)`;
    }
    case "nfip_flood_history": {
      const n = signals.nfipClaimCount ?? 0;
      if (n <= 0) return "No NFIP flood claims in ZIP";
      return `${n} NFIP flood claim${n === 1 ? "" : "s"} in ZIP`;
    }
    case "recent_quake_50mi": {
      const n = signals.recentQuakeCount ?? 0;
      if (n <= 0) return "No M3.5+ earthquakes within 50mi";
      return `${n} M3.5+ earthquake${n === 1 ? "" : "s"} within 50mi (1 yr)`;
    }
  }
}

/**
 * Build the UI-ready breakdown. Call once at score-write time and
 * persist into `leads.score_signals` (jsonb).
 *
 * Wave 1.5: rows flagged `optional` (storm_proximity_24h,
 * recent_lien_90d) only render when the lead actually scored >0 on
 * them — keeps the drawer clean for the leads that have no nearby
 * storm or lien activity.
 */
export function buildScoreSignalBreakdown(
  result: ScoreResult,
  signals: ScoringSignals,
): ScoreSignalContribution[] {
  return SCORE_SIGNAL_ORDER.flatMap(({ key, label, weight, resultKey, optional }) => {
    const raw = result[resultKey] ?? 0;
    const value = Math.round(Math.max(0, Math.min(weight, raw)));
    if (optional && value <= 0) return [];
    return [{
      signal: key,
      label,
      weight,
      value,
      detail: detailFor(key, result.factors, signals),
    }];
  });
}

/**
 * Client-safe: verify a payload came from us (same shape) before
 * rendering. Defends against old rows or hand-edited jsonb.
 */
export function isScoreSignalBreakdown(
  value: unknown,
): value is ScoreSignalContribution[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof (r as Record<string, unknown>).signal === "string" &&
      typeof (r as Record<string, unknown>).label === "string" &&
      typeof (r as Record<string, unknown>).weight === "number" &&
      typeof (r as Record<string, unknown>).value === "number",
  );
}
