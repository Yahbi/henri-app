/**
 * Predictive cross-trade rules engine
 *
 * Phase 1.2 of the 2026-04-26 product roadmap. The user's vision:
 *
 *   "If a permit is created for a pool, maybe we need to send it to the
 *    landscaper to invite the homeowner to have the landscape around
 *    the pool being done."
 *
 *   "If a property was built in 1960, with no prior historical permit
 *    to have the roof being reworked or rebuilt, it should flag it and
 *    invite the roofer to send a text or quote to homeowner."
 *
 * This module evaluates a lead against 8 deterministic rules and returns
 * cross-trade opportunities. The output is written to
 * `leads.cross_trade_suggestions` jsonb (migration 00045) by the cron
 * scorer, then surfaced in the Lead Detail Drawer's CrossTradeOpportunities
 * component.
 *
 * ## Why deterministic, not LLM
 *
 * Per CLAUDE.md: "Scoring engine: src/lib/scoring/ — deterministic math,
 * no LLM." Same principle applies here. Rules are reviewable, testable,
 * cheap, and don't fail open under API outage. Phase 2.1 layers an LLM
 * description-mining agent on TOP of these rules to catch signals regex
 * can't (per the roadmap).
 *
 * ## How the wedge contract supports this
 *
 * Migration 00031's exclusivity locks are PER-(lead_id, trade), not
 * per-permit. That means the same permit can hold a roofing lock for
 * contractor A AND a landscaping lock for contractor B simultaneously.
 * When this engine emits a cross-trade suggestion, the UI's "Forward to
 * <trade> contractor" action creates a NEW leads row with the same
 * permit_id and a different trade — the existing matching engine
 * routes it to a contractor in that trade with no exclusivity conflict.
 *
 * ## Adding a new rule
 *
 * 1. Append to RULES below with a unique `name`
 * 2. Implement `trigger(ctx)` returning a boolean
 * 3. Implement `reason(ctx)` returning the homeowner-friendly hook
 * 4. Add a unit test in `__tests__/rules.test.ts`
 *
 * Confidence values are rough heuristics, not probabilities. Treat them
 * as a sort key for which suggestions to surface first.
 */

import type { Lead } from "@/types/lead";

/* ── Address-permit-history shape (migration 00025) ─────────────────── */

/**
 * Per-property aggregation. Read-only; populated by the cron permit
 * pipeline. Not all leads have a matching row — first-time addresses
 * (no prior permits) hit the rules with `history === null`.
 */
export interface AddressPermitHistory {
  address_norm: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  permit_count: number;
  total_value: number | null; // bigint cents, may be null
  first_permit_date: string | null; // ISO date
  last_permit_date: string | null; // ISO date
  trades: string[]; // distinct normalized trade slugs
  permits: HistoryPermit[]; // jsonb array per migration 00025
}

export interface HistoryPermit {
  permit_number?: string;
  permit_type?: string;
  applied_date?: string;
  issued_date?: string;
  value?: number;
  status?: string;
  trade?: string;
  /** Free-text scope-of-work description. May contain pool/roof/electrical
   *  signals not captured in the structured `trade` column. */
  description?: string;
}

/* ── Rule shape ─────────────────────────────────────────────────────── */

export interface PredictiveContext {
  /** The lead being scored. Has the current permit's trade/value/age. */
  lead: Lead;
  /** Per-property aggregation across all known permits. NULL when this
   *  is a first-time address or migration 00025 hasn't ingested yet. */
  history: AddressPermitHistory | null;
}

export interface PredictiveRule {
  /** Stable identifier — used in the suggestion's `rule` field for
   *  analytics. Must be unique across RULES. */
  name: string;
  /** Target trade slug. The drawer's "Forward to ..." action creates a
   *  new leads row with this trade. Must match the matching engine's
   *  contractor `trade` column. */
  trade: string;
  /** Rough heuristic 0..1 of how strong this signal is. Used to sort
   *  suggestions in the drawer. Calibrate after 90 days of close-rate
   *  data per Phase 3.2. */
  confidence: number;
  /** Predicate. Pure function of context; no I/O. */
  trigger: (ctx: PredictiveContext) => boolean;
  /** Homeowner-friendly hook that becomes the SMS/email opening line
   *  when the cross-trade lead is forwarded. */
  reason: (ctx: PredictiveContext) => string;
}

export interface CrossTradeSuggestion {
  trade: string;
  rule: string;
  confidence: number;
  reason: string;
  generated_at: string;
}

/* ── Helper predicates ──────────────────────────────────────────────── */

/** Year a permit was filed/issued. Returns null when neither date present. */
function permitYear(p: HistoryPermit): number | null {
  const d = p.applied_date ?? p.issued_date;
  if (!d) return null;
  const y = new Date(d).getFullYear();
  return Number.isFinite(y) ? y : null;
}

/** Check if any permit in history has a trade matching `predicate`. */
function hasHistoryWithTrade(
  history: AddressPermitHistory | null,
  predicate: (trade: string) => boolean,
): boolean {
  if (!history) return false;
  return history.trades.some((t) => predicate((t ?? "").toLowerCase()));
}

/** Years since the most recent permit of a given trade. Null when no
 *  matching permit exists. */
function yearsSinceTrade(
  history: AddressPermitHistory | null,
  predicate: (trade: string) => boolean,
): number | null {
  if (!history) return null;
  const permits = Array.isArray(history.permits) ? history.permits : [];
  const matching = permits.filter((p) =>
    predicate(String(p?.trade ?? "").toLowerCase()),
  );
  if (matching.length === 0) return null;
  const years = matching.map(permitYear).filter((y): y is number => y !== null);
  if (years.length === 0) return null;
  const mostRecent = Math.max(...years);
  const now = new Date().getFullYear();
  return now - mostRecent;
}

/** Normalize lead trade for comparison. Lowercase, trim. */
function leadTrade(lead: Lead): string {
  return (lead.trade ?? lead.permit_type ?? "").toLowerCase().trim();
}

/** Lead permit description, lowercased for keyword matching. */
function leadDesc(lead: Lead): string {
  return (lead.permit_description ?? "").toLowerCase();
}

/** Years since the property was built. Null when year_built unknown. */
function propertyAge(lead: Lead): number | null {
  if (!lead.year_built) return null;
  return new Date().getFullYear() - lead.year_built;
}

/* ── Rule definitions ───────────────────────────────────────────────── */

/**
 * 8 deterministic rules. Order is for readability — the engine evaluates
 * all of them and sorts the matches by confidence at the end.
 *
 * Confidence values are heuristics:
 *   0.7+  high-signal triggers (pool→landscaping is a known correlation)
 *   0.5-0.7  moderate (recent sale → general remodel)
 *   <0.5  speculative (don't ship below 0.5)
 */
export const RULES: PredictiveRule[] = [
  /* ── 1. Pool permit → landscaper opportunity ─────────────────────
   * Industry data: pool installs typically trigger landscape spend
   * within 6 months. Hook this as the canonical example of the
   * cross-trade vision. */
  {
    name: "pool-to-landscaper",
    trade: "landscaping",
    confidence: 0.75,
    trigger: (ctx) => {
      const tradeSlug = leadTrade(ctx.lead);
      const desc = leadDesc(ctx.lead);
      const isPoolPermit =
        tradeSlug.includes("pool") ||
        desc.includes("pool") ||
        desc.includes("spa");
      if (!isPoolPermit) return false;

      // Only flag when no recent landscape work (avoid double-suggesting).
      // `null` means "no landscape permit ever found" — valid trigger.
      // A number < 5 means "had recent landscape work" — skip.
      // Stem-match ("landscap") so both "landscape" and "landscaping"
      // permit trades hit. Same for "hardscap".
      const recentLandscape = yearsSinceTrade(ctx.history, (permitTrade) =>
        permitTrade.includes("landscap") || permitTrade.includes("hardscap"),
      );
      if (recentLandscape !== null && recentLandscape < 5) return false;
      return true;
    },
    reason: () =>
      "Pool homeowners typically spend on landscape, hardscape, and fencing within 6 months of install — open window for the right pitch.",
  },

  /* ── 2. Pre-1990 home + no electrical permit → panel upgrade ─────
   * Older homes have undersized panels (60-100A). Modern remodels
   * + EV chargers + solar push panel-upgrade demand. */
  {
    name: "old-home-electrical",
    trade: "electrical",
    confidence: 0.6,
    trigger: (ctx) => {
      const age = propertyAge(ctx.lead);
      if (age === null || age < 35) return false; // pre-1990 is age >= 35
      const hasElectrical = hasHistoryWithTrade(ctx.history, (t) =>
        t.includes("electrical"),
      );
      // Flag only when no electrical permit exists in history
      return !hasElectrical;
    },
    reason: (ctx) => {
      const age = propertyAge(ctx.lead);
      return `Property built ${age} years ago with no electrical permit on file — likely undersized panel ahead of any EV charger / solar / kitchen-remodel work.`;
    },
  },

  /* ── 3. Roof age >20yr → re-roof opportunity ─────────────────────
   * Asphalt roofs are 20-25yr lifespan. Fire it 22+ years post last
   * roof permit (or for pre-2000 homes with no roof history). */
  {
    name: "aging-roof",
    trade: "roofing",
    confidence: 0.7,
    trigger: (ctx) => {
      // Skip when the current lead is itself a roofing permit
      if (leadTrade(ctx.lead).includes("roof")) return false;
      const yearsSinceRoof = yearsSinceTrade(ctx.history, (t) =>
        t.includes("roof"),
      );
      // 22+ years since last roof permit, OR no roof permit + house >25yr
      if (yearsSinceRoof !== null && yearsSinceRoof >= 22) return true;
      const age = propertyAge(ctx.lead);
      if (yearsSinceRoof === null && age !== null && age >= 25) return true;
      return false;
    },
    reason: (ctx) => {
      const yearsSinceRoof = yearsSinceTrade(ctx.history, (t) =>
        t.includes("roof"),
      );
      if (yearsSinceRoof !== null) {
        return `Last roof permit was ${yearsSinceRoof} years ago — typical asphalt lifespan is 20-25 years. Likely re-roof window.`;
      }
      const age = propertyAge(ctx.lead);
      return `Property is ${age} years old with no roof permit on file — original roof likely past replacement window.`;
    },
  },

  /* ── 4. Solar permit → battery storage / EV charger ──────────────
   * Solar installers see ~30% attach rate on battery within 18mo.
   * EV chargers spike with solar + new-vehicle purchases. Routes
   * to electrical (battery + EV are electrical-trade work). */
  {
    name: "solar-to-battery",
    trade: "electrical",
    confidence: 0.65,
    trigger: (ctx) => {
      const t = leadTrade(ctx.lead);
      const desc = leadDesc(ctx.lead);
      const isSolar =
        t.includes("solar") ||
        t.includes("pv") ||
        desc.includes("solar") ||
        desc.includes("photovoltaic");
      // Only flag if no battery / ev-charger permit yet
      const hasBatteryOrEv = hasHistoryWithTrade(ctx.history, (t) =>
        t.includes("battery") || t.includes("ev charger") || t.includes("ess"),
      );
      return isSolar && !hasBatteryOrEv;
    },
    reason: () =>
      "Solar homeowners add battery storage or EV charger within 18 months at ~30% attach rate. Pre-permit conversations save scheduling friction.",
  },

  /* ── 5. Bath remodel → fixture upgrade ──────────────────────────
   * Open walls = cheaper fixture upgrade. Plumbing pre-rough is the
   * window for this conversation. */
  {
    name: "bath-fixtures",
    trade: "plumbing",
    confidence: 0.55,
    trigger: (ctx) => {
      const t = leadTrade(ctx.lead);
      const desc = leadDesc(ctx.lead);
      const isBath =
        t.includes("bath") ||
        desc.includes("bathroom") ||
        desc.includes("shower") ||
        desc.includes("vanity");
      // Skip if the current trade IS plumbing (no double-suggest)
      return isBath && !t.includes("plumb");
    },
    reason: () =>
      "Bathroom remodel with walls open is the cheapest window for fixture upgrades, water-line replacement, and shower-pan tile.",
  },

  /* ── 6. Kitchen remodel → countertop install ─────────────────────
   * Countertop scheduling is the kitchen-remodel bottleneck. Books
   * up 4-8 weeks. Routing this to countertop contractors gives them
   * a head-start. */
  {
    name: "kitchen-countertop",
    trade: "countertops",
    confidence: 0.6,
    trigger: (ctx) => {
      const t = leadTrade(ctx.lead);
      const desc = leadDesc(ctx.lead);
      const isKitchen =
        t.includes("kitchen") ||
        desc.includes("kitchen") ||
        desc.includes("cabinetry") ||
        desc.includes("cabinet");
      const hasCountertop = hasHistoryWithTrade(ctx.history, (t) =>
        t.includes("countertop") || t.includes("granite") || t.includes("quartz"),
      );
      return isKitchen && !hasCountertop && !t.includes("countertop");
    },
    reason: () =>
      "Kitchen remodels schedule countertop measurement 4-8 weeks out — get on the homeowner's list before the cabinet install drives the conversation.",
  },

  /* ── 7. HVAC age >15yr → replacement opportunity ─────────────────
   * Avg HVAC lifespan 15-20yr. Last HVAC permit gives a derived age. */
  {
    name: "aging-hvac",
    trade: "hvac",
    confidence: 0.7,
    trigger: (ctx) => {
      // Skip when the current lead IS an HVAC permit
      if (leadTrade(ctx.lead).includes("hvac")) return false;
      const yearsSinceHvac = yearsSinceTrade(ctx.history, (t) =>
        t.includes("hvac") ||
        t.includes("mechanical") ||
        t.includes("heating") ||
        t.includes("cooling"),
      );
      if (yearsSinceHvac !== null && yearsSinceHvac >= 16) return true;
      // Pre-1995 home with no HVAC permit + any other permit activity →
      // implies the system is OG. Defensive: only fire when we have
      // history (otherwise too speculative)
      const age = propertyAge(ctx.lead);
      if (
        yearsSinceHvac === null &&
        age !== null &&
        age >= 30 &&
        ctx.history &&
        ctx.history.permit_count > 0
      ) {
        return true;
      }
      return false;
    },
    reason: (ctx) => {
      const yearsSinceHvac = yearsSinceTrade(ctx.history, (t) =>
        t.includes("hvac") || t.includes("mechanical"),
      );
      if (yearsSinceHvac !== null) {
        return `Last HVAC permit was ${yearsSinceHvac} years ago — typical lifespan is 15-20 years. Replacement conversation timing.`;
      }
      const age = propertyAge(ctx.lead);
      return `Property is ${age} years old with no HVAC permit on file — original system likely past replacement window.`;
    },
  },

  /* ── 8. Recent sale (<90d) → general remodel ─────────────────────
   * New owners have a remodel impulse in the first 6 months. Painting,
   * flooring, kitchen are the top trades to flag. Routes to general
   * remodel (existing matching-engine RELATED_TRADES picks up the rest). */
  {
    name: "new-owner-remodel",
    trade: "general",
    confidence: 0.5,
    trigger: (ctx) => {
      // owner_since is the most recent transfer date. If <90d, fire.
      if (!ctx.lead.owner_since) return false;
      const owned = new Date(ctx.lead.owner_since).getTime();
      if (!Number.isFinite(owned)) return false;
      const daysOwned = (Date.now() - owned) / 86_400_000;
      return daysOwned >= 0 && daysOwned <= 90;
    },
    reason: () =>
      "New owners (within 90 days) make their largest remodel decisions in the first 6 months — paint, flooring, kitchen, landscaping all in motion.",
  },
];

/* ── Engine ─────────────────────────────────────────────────────────── */

/**
 * Evaluate every rule and return matches sorted by confidence (highest
 * first). Empty array when no rule fires.
 *
 * Pure function. Safe to call from cron, route handlers, or tests with
 * mock contexts.
 */
export function evaluateRules(ctx: PredictiveContext): CrossTradeSuggestion[] {
  const now = new Date().toISOString();
  const matches: CrossTradeSuggestion[] = [];

  for (const rule of RULES) {
    let fired = false;
    try {
      fired = rule.trigger(ctx);
    } catch {
      // Defensive: a buggy rule trigger shouldn't take down the whole
      // batch. Per CLAUDE.md graceful-degrade — skip and move on.
      continue;
    }
    if (!fired) continue;

    let reason: string;
    try {
      reason = rule.reason(ctx);
    } catch {
      reason = "Cross-trade opportunity detected.";
    }

    matches.push({
      trade: rule.trade,
      rule: rule.name,
      confidence: rule.confidence,
      reason,
      generated_at: now,
    });
  }

  // Sort highest-confidence first. Ties broken by rule name for stability.
  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.rule.localeCompare(b.rule);
  });

  return matches;
}

/**
 * Convenience: return only the top N suggestions. Used by the drawer
 * which has limited vertical space.
 */
export function topSuggestions(
  ctx: PredictiveContext,
  n = 3,
): CrossTradeSuggestion[] {
  return evaluateRules(ctx).slice(0, n);
}
