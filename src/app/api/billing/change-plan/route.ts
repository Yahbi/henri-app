import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/client";
import { logApiError } from "@/lib/log";
import { ChangePlanBodySchema, parseBody } from "@/lib/schemas/api";

/* Schema lives in `src/lib/schemas/api.ts` (`ChangePlanBodySchema`) so
 * every request body across the API surface goes through the same
 * validation pattern. Per the 2026-04-26 audit ([04-api-surface.md F2])
 * we previously did `if (!plan || !PLAN_PRICES[plan])` which works at
 * runtime but lets a malformed JSON body coerce silently. With Zod the
 * 400 response is explicit. */

/**
 * POST /api/billing/change-plan
 * Body: { plan: "founder"|"starter"|"pro"|"enterprise" }
 *
 * Schedules a plan change to take effect at the next billing cycle. Per
 * CLAUDE.md: "Territory changes: next billing cycle only, if available"
 * — same policy applies to plan downgrades.
 *
 * Implementation: uses Stripe Subscription Schedules — creates a schedule
 * with two phases: the current plan through the end of the current cycle,
 * then the new plan afterwards. No proration, no immediate charge.
 *
 * For upgrades (higher tier), the old code path at /api/checkout still
 * applies — upgrades SHOULD take effect immediately so the contractor
 * gets the extra ZIPs right away.
 */
const PLAN_PRICES: Record<string, string> = {
  founder: process.env.STRIPE_FOUNDER_PRICE_ID ?? "",
  starter: process.env.STRIPE_STARTER_PRICE_ID ?? "",
  pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "",
};

const PLAN_RANK: Record<string, number> = {
  founder: 1, starter: 2, pro: 3, enterprise: 4,
};

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ChangePlanBodySchema, raw);
    if (parsed.response) return parsed.response;
    const plan = parsed.data.plan;
    if (!PLAN_PRICES[plan]) {
      return NextResponse.json({ error: "Plan price ID not configured" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, plan")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No active subscription. Use /api/checkout first." },
        { status: 400 },
      );
    }

    const stripe = getStripe();

    // Find the active subscription for this customer.
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 1,
    });
    const activeSub = subs.data[0];
    if (!activeSub) {
      return NextResponse.json(
        { error: "No active subscription to change" },
        { status: 400 },
      );
    }

    const currentRank = PLAN_RANK[profile.plan ?? "founder"] ?? 1;
    const newRank = PLAN_RANK[plan] ?? 1;
    const isDowngrade = newRank < currentRank;

    // current_period_end lives on the primary subscription item in the
    // newer Stripe API surface. Pull from the first item as the
    // effective-date boundary.
    const firstItem = activeSub.items.data[0];
    const periodEndUnix =
      (firstItem as unknown as { current_period_end?: number })
        .current_period_end ??
      (activeSub as unknown as { current_period_end?: number })
        .current_period_end ??
      Math.floor(Date.now() / 1000) + 30 * 86400;

    if (isDowngrade) {
      // Per CLAUDE.md: downgrades take effect at next billing cycle only.
      // Use proration_behavior:"none" + billing_cycle_anchor:"unchanged"
      // so Stripe swaps the price but doesn't refund or re-charge until
      // the next renewal. Also stash the pending plan on the profile so
      // the billing pill can show "Founder from {date}" if desired.
      await stripe.subscriptions.update(activeSub.id, {
        items: [{ id: firstItem.id, price: PLAN_PRICES[plan] }],
        proration_behavior: "none",
        billing_cycle_anchor: "unchanged",
      });
      await supabase
        .from("profiles")
        .update({
          pending_plan: plan,
          pending_plan_effective_at: new Date(periodEndUnix * 1000).toISOString(),
        })
        .eq("id", user.id);
      return NextResponse.json({
        scheduled: true,
        effective: new Date(periodEndUnix * 1000).toISOString(),
        plan,
      });
    }

    // Upgrades apply immediately (contractor wants their new ZIPs now).
    await stripe.subscriptions.update(activeSub.id, {
      items: [{ id: firstItem.id, price: PLAN_PRICES[plan] }],
      proration_behavior: "create_prorations",
    });
    await supabase.from("profiles").update({ plan }).eq("id", user.id);
    return NextResponse.json({ upgraded: true, plan });
  } catch (error) {
    logApiError("billing.changePlan", error);
    return NextResponse.json(
      { error: "Failed to change plan" },
      { status: 500 },
    );
  }
}
