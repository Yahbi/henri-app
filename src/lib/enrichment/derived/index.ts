/**
 * Derived enrichments — pure functions that infer signals from
 * already-collected data (year_built, permit history, descriptions).
 *
 * Phase 2.3 of the post-audit roadmap. Per the capabilities-research
 * agent: most "missing" enrichment data (roof age, HVAC age, pool/solar
 * presence) is derivable from data we already have, no new API needed.
 *
 * Each function takes a `DerivationContext` and returns a typed result
 * or `null` when not derivable. The orchestrator's Phase D writes these
 * into dedicated columns on `leads`. Until that wiring lands, the
 * functions are also callable from any cron / route handler.
 *
 * Per CLAUDE.md "no LLM in deterministic paths": all derivations are
 * regex + arithmetic. The LLM description-miner (Phase 2.1) layers on
 * top, never replaces these.
 */

import type { Lead } from "@/types/lead";
import type { AddressPermitHistory, HistoryPermit } from "@/lib/predictive/rules";

export interface DerivationContext {
  lead: Lead;
  history: AddressPermitHistory | null;
}

/* ── Helpers (shared) ───────────────────────────────────────────────── */

const THIS_YEAR = () => new Date().getFullYear();

function permitYear(p: HistoryPermit): number | null {
  const d = p.applied_date ?? p.issued_date;
  if (!d) return null;
  const y = new Date(d).getFullYear();
  return Number.isFinite(y) ? y : null;
}

function mostRecentPermitYear(
  history: AddressPermitHistory | null,
  predicate: (trade: string) => boolean,
): number | null {
  if (!history) return null;
  const matching = history.permits.filter((p) =>
    predicate(String(p?.trade ?? "").toLowerCase()),
  );
  const years = matching
    .map(permitYear)
    .filter((y): y is number => y !== null);
  if (years.length === 0) return null;
  return Math.max(...years);
}

/* ── Roof age derivation ────────────────────────────────────────────── */

export interface RoofAgeEstimate {
  /** Years since last roof permit, or since year_built if no roof history. */
  years_since: number;
  /** "permit-history" or "year-built" — provenance for the contractor. */
  derived_from: "permit-history" | "year-built";
  /** Last roof permit year, when available. */
  last_roof_permit_year: number | null;
  /** Likely replacement window? Asphalt typically 20-25 years. */
  replacement_window: "due" | "approaching" | "fresh";
}

export function deriveRoofAge(ctx: DerivationContext): RoofAgeEstimate | null {
  const last = mostRecentPermitYear(ctx.history, (t) => t.includes("roof"));
  if (last !== null) {
    const yearsSince = THIS_YEAR() - last;
    return {
      years_since: yearsSince,
      derived_from: "permit-history",
      last_roof_permit_year: last,
      replacement_window:
        yearsSince >= 22 ? "due" : yearsSince >= 15 ? "approaching" : "fresh",
    };
  }
  if (ctx.lead.year_built) {
    const yearsSince = THIS_YEAR() - ctx.lead.year_built;
    return {
      years_since: yearsSince,
      derived_from: "year-built",
      last_roof_permit_year: null,
      replacement_window:
        yearsSince >= 25 ? "due" : yearsSince >= 18 ? "approaching" : "fresh",
    };
  }
  return null;
}

/* ── HVAC age derivation ────────────────────────────────────────────── */

export interface HvacAgeEstimate {
  years_since: number;
  derived_from: "permit-history" | "year-built";
  last_hvac_permit_year: number | null;
  replacement_window: "due" | "approaching" | "fresh";
}

export function deriveHvacAge(ctx: DerivationContext): HvacAgeEstimate | null {
  const last = mostRecentPermitYear(ctx.history, (t) =>
    t.includes("hvac") ||
    t.includes("mechanical") ||
    t.includes("heating") ||
    t.includes("cooling") ||
    t.includes("furnace"),
  );
  if (last !== null) {
    const yearsSince = THIS_YEAR() - last;
    return {
      years_since: yearsSince,
      derived_from: "permit-history",
      last_hvac_permit_year: last,
      replacement_window:
        yearsSince >= 16 ? "due" : yearsSince >= 12 ? "approaching" : "fresh",
    };
  }
  if (ctx.lead.year_built && ctx.history && ctx.history.permit_count > 0) {
    // House had permits but never an HVAC permit — original system.
    const yearsSince = THIS_YEAR() - ctx.lead.year_built;
    if (yearsSince < 30) return null; // not old enough to flag
    return {
      years_since: yearsSince,
      derived_from: "year-built",
      last_hvac_permit_year: null,
      replacement_window: "due",
    };
  }
  return null;
}

/* ── Pool presence ──────────────────────────────────────────────────── */

export interface PoolPresenceResult {
  present: boolean;
  /** "current-permit" / "history" / "none" */
  source: "current-permit" | "history" | "none";
  /** Year the pool permit was filed, when known. */
  pool_year: number | null;
}

const POOL_KEYWORDS = /\b(swimming\s*pool|in-?ground\s*pool|pool\s*(install|construction|build)|spa|hot\s*tub)\b/i;

export function derivePoolPresence(ctx: DerivationContext): PoolPresenceResult {
  // Check current permit
  const desc = (ctx.lead.permit_description ?? "").toLowerCase();
  const trade = (ctx.lead.trade ?? "").toLowerCase();
  if (trade.includes("pool") || POOL_KEYWORDS.test(desc)) {
    return {
      present: true,
      source: "current-permit",
      pool_year: THIS_YEAR(),
    };
  }
  // Check history
  if (ctx.history) {
    const poolPermit = ctx.history.permits.find((p) => {
      const t = String(p?.trade ?? "").toLowerCase();
      const d = String(p?.description ?? "").toLowerCase();
      return t.includes("pool") || POOL_KEYWORDS.test(d);
    });
    if (poolPermit) {
      return {
        present: true,
        source: "history",
        pool_year: permitYear(poolPermit),
      };
    }
  }
  return { present: false, source: "none", pool_year: null };
}

/* ── Solar presence ─────────────────────────────────────────────────── */

export interface SolarPresenceResult {
  present: boolean;
  source: "current-permit" | "history" | "none";
  solar_year: number | null;
  /** Years since solar install — useful for "battery-storage upsell" timing. */
  years_since: number | null;
}

const SOLAR_KEYWORDS = /\b(solar|photovoltaic|pv\s*system|pv\s*array|rooftop\s*solar)\b/i;

export function deriveSolarPresence(ctx: DerivationContext): SolarPresenceResult {
  const desc = (ctx.lead.permit_description ?? "").toLowerCase();
  const trade = (ctx.lead.trade ?? "").toLowerCase();
  if (trade.includes("solar") || trade.includes("pv") || SOLAR_KEYWORDS.test(desc)) {
    return {
      present: true,
      source: "current-permit",
      solar_year: THIS_YEAR(),
      years_since: 0,
    };
  }
  if (ctx.history) {
    const solarPermit = ctx.history.permits.find((p) => {
      const t = String(p?.trade ?? "").toLowerCase();
      const d = String(p?.description ?? "").toLowerCase();
      return t.includes("solar") || t.includes("pv") || SOLAR_KEYWORDS.test(d);
    });
    if (solarPermit) {
      const year = permitYear(solarPermit);
      return {
        present: true,
        source: "history",
        solar_year: year,
        years_since: year !== null ? THIS_YEAR() - year : null,
      };
    }
  }
  return { present: false, source: "none", solar_year: null, years_since: null };
}

/* ── Electrical panel age (heuristic) ───────────────────────────────── */

export interface PanelAgeEstimate {
  estimate: "likely-undersized" | "likely-modernized" | "unknown";
  /** Year of the last electrical permit (panel work or otherwise). */
  last_electrical_year: number | null;
}

export function derivePanelAge(ctx: DerivationContext): PanelAgeEstimate {
  const last = mostRecentPermitYear(ctx.history, (t) =>
    t.includes("electrical"),
  );
  // Recent electrical work → modernized
  if (last !== null) {
    const yearsSince = THIS_YEAR() - last;
    return {
      estimate: yearsSince <= 15 ? "likely-modernized" : "likely-undersized",
      last_electrical_year: last,
    };
  }
  // No electrical history + old home → likely undersized
  if (ctx.lead.year_built && ctx.lead.year_built < 1980) {
    return { estimate: "likely-undersized", last_electrical_year: null };
  }
  return { estimate: "unknown", last_electrical_year: null };
}

/* ── Bundled API ────────────────────────────────────────────────────── */

export interface DerivedEnrichments {
  roof_age: RoofAgeEstimate | null;
  hvac_age: HvacAgeEstimate | null;
  pool: PoolPresenceResult;
  solar: SolarPresenceResult;
  panel_age: PanelAgeEstimate;
}

/**
 * Run all derivations against a single context. Returns null only for
 * derivations that are inherently nullable (roof_age, hvac_age) — pool,
 * solar, and panel_age always return a result (with `present: false` /
 * `estimate: "unknown"` when no signal).
 *
 * Pure function. No I/O. Safe to call from cron or route handler.
 */
export function deriveAll(ctx: DerivationContext): DerivedEnrichments {
  return {
    roof_age: deriveRoofAge(ctx),
    hvac_age: deriveHvacAge(ctx),
    pool: derivePoolPresence(ctx),
    solar: deriveSolarPresence(ctx),
    panel_age: derivePanelAge(ctx),
  };
}
