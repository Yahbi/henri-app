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
 *   free        → no map access (already enforced)
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

export interface TradeGate {
  /** When non-null, server-side queries should add `eq("trade", X)`. */
  tradeFilter: string | null;
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
    return { tradeFilter: null, seesAllTrades: true, profileTrade: trade, plan };
  }

  // 3. General contractors / unset trade → all trades. A contractor whose
  //    trade is "general" needs cross-trade visibility by definition.
  if (!trade || trade === "general" || trade === "other") {
    return { tradeFilter: null, seesAllTrades: true, profileTrade: trade, plan };
  }

  // 4. Otherwise: founder/starter/pro with a specific trade → trade-gated.
  return { tradeFilter: trade, seesAllTrades: false, profileTrade: trade, plan };
}
