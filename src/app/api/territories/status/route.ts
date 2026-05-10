import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { planInfo, nextTier } from "@/lib/territory/plan-caps";
import { resolveTradeGate } from "@/lib/auth/trade-gating";

export const runtime = "nodejs";

/**
 * GET /api/territories/status
 *
 * Returns the contractor's territory + plan posture in a single payload
 * the map page consumes to render the TerritoryStatusChip.
 *
 * Response:
 *   {
 *     plan: "founder",
 *     plan_label: "Founder",
 *     monthly_price: 149,
 *     zip_cap: 3,
 *     zips_claimed: 2,
 *     zips_remaining: 1,
 *     sees_all_trades: false,
 *     gated_trade: "plumbing",            // null when sees_all_trades=true
 *     next_tier: { tier: "starter", label: "Starter", monthly_price_dollars: 749, zip_cap: 5, ... },
 *     upgrade_unlocks_trades: false,       // true only when next tier is enterprise
 *     upgrade_adds_zips: 2                 // delta from cap to next.zip_cap
 *   }
 */
export async function GET() {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;

  // 1. Read profile.plan + profile.trade.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("plan, trade")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr || !profile) {
    return NextResponse.json({ error: "profile not found" }, { status: 404 });
  }
  const p = profile as Record<string, unknown>;
  const plan = (p.plan as string) ?? "free";
  const info = planInfo(plan);
  const next = nextTier(plan);

  // 2. Count active claimed territories. RLS gates this to the caller.
  const { count, error: countErr } = await supabase
    .from("territories")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", user.id)
    .eq("status", "active");
  const zipsClaimed = countErr ? 0 : (count ?? 0);

  // 3. Resolve trade-gating decision (god-mode bypass etc.).
  const tradeGate = await resolveTradeGate(supabase, user);

  return NextResponse.json({
    plan,
    plan_label: info.label,
    monthly_price: info.monthly_price_dollars,
    zip_cap: info.zip_cap,
    zips_claimed: zipsClaimed,
    zips_remaining: Math.max(0, info.zip_cap - zipsClaimed),
    sees_all_trades: tradeGate.seesAllTrades,
    gated_trade: tradeGate.tradeFilter,
    profile_trade: tradeGate.profileTrade,
    next_tier: next
      ? {
          tier: next.tier,
          label: next.label,
          monthly_price_dollars: next.monthly_price_dollars,
          zip_cap: next.zip_cap,
        }
      : null,
    upgrade_unlocks_trades: next?.tier === "enterprise" && !tradeGate.seesAllTrades,
    upgrade_adds_zips: next ? Math.max(0, next.zip_cap - info.zip_cap) : 0,
  });
}
