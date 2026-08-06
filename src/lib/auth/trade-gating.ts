/**
 * Trade-gating per pricing tier.
 *
 * Module 19 of the 18-module enhancement plan (extension shipped 2026-05-09).
 *
 * Founder direction: "the main feature I wanted to implement was that lead
 * by trade — each contractor on signing in just sees their trade. A GC will
 * pay more to see all trades. A plumbing contractor will see only plumbing."
 *
 * Plan → trade access:
 *   free        → own trade only, same as any other non-enterprise plan.
 *                 This line used to read "no map access (already enforced)".
 *                 It was not enforced and is not enforced now: the only
 *                 plan-aware branch in this file is the `enterprise` check
 *                 below, and `/api/leads/map` gates solely on
 *                 `requireContractor` (auth + role="contractor") — it never
 *                 reads `profiles.plan` to admit or deny. What actually
 *                 keeps a non-paying account off the map is (a) middleware
 *                 redirecting incomplete onboarding away from /dashboard,
 *                 and (b) owning zero territories, which leaves the ZIP
 *                 list empty and the response with no leads. Neither is a
 *                 plan check. A comment asserting a protection is not a
 *                 protection — if free-tier map access should 402, add the
 *                 check to the route and restate this line.
 *   founder     → own trade only
 *   starter     → own trade only
 *   pro         → own trade only (Pro is most popular but still trade-gated;
 *                                 gated multi-trade lands as a future tier)
 *   enterprise  → all trades (the "GC tier" the founder named)
 *
 * Bypassed for god-mode (founder + dev allowlist) so internal users can
 * audit every lead regardless of plan.
 *
 * Exception: when profile.trade is `general` or NULL we treat the contractor
 * as a GC and lift the gate — they need cross-trade visibility by definition.
 *
 * Returned `tradeFilter`:
 *   null  → no filter (all trades)
 *   string → single trade value to apply as `eq("trade", X)`
 *
 * Returned `sees_all_trades`:
 *   true   → the contractor's plan or role sees all trades (UI hides the
 *            upgrade banner)
 *   false  → trade-gated (UI surfaces an upgrade-to-GC CTA)
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isGodModeEmail } from "./god-mode";

/**
 * `leads.trade` values that carry no trade information at all.
 *
 * 2026-08-05 live counts over 274,783 leads:
 *   other 156,457 · residential 45,123 · commercial 41,003 · general 7,467
 * That is 90% of the table sitting in four buckets which mean "the ingest
 * could not classify this permit", NOT "this job is not yours". The next
 * bucket down is renovation at 11,622; every genuinely trade-specific value
 * is tiny (electrical 1,850 · roofing 843 · hvac 776 · plumbing 233).
 *
 * Consequence of the old gate: a paying single-trade contractor was filtered
 * with `trade = 'hvac'`, matching 776 of 274,783 rows — a near-empty map,
 * while the jobs that actually were theirs sat in the "other" pile. These
 * four buckets are therefore always included; an unclassifiable lead must
 * never be silently hidden from the one contractor who could work it.
 */
export const GENERIC_TRADE_BUCKETS = [
  "other",
  "residential",
  "commercial",
  "general",
] as const;

/**
 * `profiles.trade` → `leads.trade_tags` aliases.
 *
 * `trade_tags` is the richer taxonomy derived from the permit description by
 * `deriveTradeTags()` (src/lib/intent/derive.ts, 18 keywords). It is populated
 * on 62,239 leads (23%), and — crucially — on 16,922 leads whose `trade`
 * column is the useless literal "other". Matching on tags recovers real work
 * the exact-string gate dropped, e.g. an "hvac" contractor picks up every
 * permit whose description says furnace / air conditioning even though the
 * ingest stamped it trade='other'.
 *
 * Only trades whose tag name differs from the enum value, or which fan out to
 * several tags, need an entry — `tradeTagsFor()` falls back to the trade
 * string itself, which is already the correct tag for hvac / roofing /
 * plumbing / electrical / solar / concrete / pool / landscaping / foundation.
 */
const TRADE_TAG_ALIASES: Record<string, string[]> = {
  plumbing: ["plumbing", "sewer"],
  concrete: ["concrete", "foundation"],
  foundation: ["foundation", "concrete"],
  fencing: ["landscaping"],
  decking: ["landscaping"],
  windows_doors: ["windows"],
  bathroom: ["bath", "remodel"],
  kitchen: ["kitchen", "remodel"],
  renovation: ["remodel", "kitchen", "bath", "flooring"],
  addition: ["general_construction", "adu", "garage_conversion"],
  new_construction: ["general_construction", "adu"],
  demolition: ["general_construction"],
  // No tag in the derive.ts taxonomy corresponds to these, so tag-matching
  // contributes nothing and the generic-bucket always-include carries them.
  repair: [],
  signage: [],
  fire_protection: [],
};

/** Tags in `leads.trade_tags` that should also match this contractor's trade. */
export function tradeTagsFor(trade: string | null): string[] {
  if (!trade) return [];
  if (Object.prototype.hasOwnProperty.call(TRADE_TAG_ALIASES, trade)) {
    return TRADE_TAG_ALIASES[trade];
  }
  return [trade];
}

export interface TradeGate {
  /** When non-null, server-side queries should gate on this trade. */
  tradeFilter: string | null;
  /**
   * `leads.trade_tags` values that also belong to this contractor. Empty when
   * the gate is lifted. Consumers must OR these against `tradeFilter` rather
   * than using `eq("trade", tradeFilter)` alone — see GENERIC_TRADE_BUCKETS
   * for why exact-string equality hides 90% of the table.
   */
  tradeTags: string[];
  /** When true the contractor unlocks all trades — no UI banner needed. */
  seesAllTrades: boolean;
  /** Profile fields used in the decision; surfaced for the UI banner copy. */
  profileTrade: string | null;
  plan: string | null;
}

/** Pull the contractor's profile and decide trade access. */
export async function resolveTradeGate(
  supabase: SupabaseClient,
  user: User,
): Promise<TradeGate> {
  // 1. God-mode bypass — founder + dev allowlist always sees every trade.
  if (isGodModeEmail(user.email)) {
    return {
      tradeFilter: null,
      tradeTags: [],
      seesAllTrades: true,
      profileTrade: null,
      plan: null,
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("trade, plan")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    // Conservative default: no filter when we can't look up the profile.
    // (Subscriber tier already enforces other guards; trade-gating is one
    //  layer of personalisation, not a security boundary.)
    return {
      tradeFilter: null,
      tradeTags: [],
      seesAllTrades: true,
      profileTrade: null,
      plan: null,
    };
  }

  const r = data as Record<string, unknown>;
  const trade = (r.trade as string | null) ?? null;
  const plan = (r.plan as string | null) ?? null;

  // 2. Enterprise (GC tier) → all trades.
  if (plan === "enterprise") {
    return {
      tradeFilter: null,
      tradeTags: [],
      seesAllTrades: true,
      profileTrade: trade,
      plan,
    };
  }

  // 3. General contractors / unset trade → all trades. A contractor whose
  //    trade is "general" needs cross-trade visibility by definition.
  //    2026-08-05: "residential" and "commercial" joined this list. They are
  //    building-class buckets, not trades — a profile stamped with one of them
  //    tells us nothing about which jobs to show, so gating on it filtered a
  //    contractor down to an arbitrary 45k/41k slice of the table on no real
  //    signal. Lifting the gate is the honest behaviour.
  if (
    !trade ||
    (GENERIC_TRADE_BUCKETS as readonly string[]).includes(trade)
  ) {
    return {
      tradeFilter: null,
      tradeTags: [],
      seesAllTrades: true,
      profileTrade: trade,
      plan,
    };
  }

  // 4. Otherwise: founder/starter/pro with a specific trade → trade-gated.
  return {
    tradeFilter: trade,
    tradeTags: tradeTagsFor(trade),
    seesAllTrades: false,
    profileTrade: trade,
    plan,
  };
}
