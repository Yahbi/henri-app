import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logApiError } from "@/lib/log";
import { ChangePlanBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";

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
 * from the live subscription with two phases: the current plan through the
 * end of the current cycle, then the new plan afterwards. No proration, no
 * immediate charge, and the current entitlement is retained until the
 * boundary. (Before 2026-08-04 this comment described behaviour the code
 * did not have — the branch swapped the price synchronously, so a
 * "scheduled" downgrade took effect on click with no refund.)
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
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ChangePlanBodySchema, raw);
    if (parsed.response) return parsed.response;
    const plan = parsed.data.plan;
    if (!PLAN_PRICES[plan]) {
      return NextResponse.json({ error: "Plan price ID not configured" }, { status: 400 });
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
    /* Constructed BEFORE any Stripe call on purpose: createAdminClient()
     * throws when SUPABASE_SERVICE_ROLE_KEY is missing, and failing there is
     * far better than failing after the subscription has already moved. */
    const admin = createAdminClient();

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
      /* Per CLAUDE.md: downgrades take effect at next billing cycle only,
       * and there are no refunds — so the deferral has to be real.
       *
       * 2026-08-04 audit: this branch previously called
       * `stripe.subscriptions.update({ items: [{ price: <lower> }] })`.
       * That mutates the live subscription immediately —
       * `proration_behavior:"none"` only suppresses proration line items and
       * `billing_cycle_anchor:"unchanged"` only preserves the renewal date;
       * neither defers the swap. Stripe then emitted
       * customer.subscription.updated carrying the lower price and the
       * webhook wrote the downgrade at once. A Pro contractor who had
       * already paid $1,499 for the cycle dropped from a 12-ZIP to a 3-ZIP
       * entitlement the instant they clicked Continue (and an Enterprise
       * downgrade additionally lost all-trades visibility), with no credit
       * — while the confirmation dialog promised full access until the
       * cycle end.
       *
       * A two-phase Subscription Schedule keeps the current price live
       * through `periodEndUnix` and only then moves to the new one, so the
       * webhook keeps resolving the current tier until the boundary. */
      /* Resolved BEFORE the schedule is created (2026-08-06). This check
       * used to sit after `subscriptionSchedules.create`, so a subscription
       * item with no price returned 500 while leaving a freshly-created
       * schedule attached to the live subscription. It needs nothing from
       * the schedule, so it belongs here. */
      const currentPriceId = firstItem.price?.id;
      if (!currentPriceId) {
        return NextResponse.json(
          { error: "Could not resolve current price — plan unchanged" },
          { status: 500 },
        );
      }

      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: activeSub.id,
      });

      /* From here on the schedule MANAGES the subscription. If the phase
       * rewrite below fails and we just return, the schedule stays attached
       * holding only the single phase Stripe imported — and Stripe rejects
       * direct `subscriptions.update` calls on a schedule-managed
       * subscription, so this route's own upgrade branch would 500 for that
       * contractor from then on. Releasing hands billing control back to the
       * subscription with nothing changed. */
      try {
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: "release",
          phases: [
            {
              items: [{ price: currentPriceId, quantity: 1 }],
              start_date: schedule.phases[0]?.start_date,
              end_date: periodEndUnix,
              proration_behavior: "none",
            },
            {
              items: [{ price: PLAN_PRICES[plan], quantity: 1 }],
              start_date: periodEndUnix,
              proration_behavior: "none",
            },
          ],
        });
      } catch (scheduleErr) {
        await stripe.subscriptionSchedules
          .release(schedule.id)
          .catch((releaseErr: unknown) => {
            logApiError("billing.changePlan.scheduleRelease", releaseErr, {
              scheduleId: schedule.id,
            });
          });
        logApiError("billing.changePlan.scheduleUpdate", scheduleErr, {
          plan,
          scheduleId: schedule.id,
        });
        return NextResponse.json(
          { error: "Could not schedule the plan change — your current plan is unchanged." },
          { status: 500 },
        );
      }

      /* Service-role, same reasoning as the upgrade write below. These two
       * columns are not locked by 00117 today, but that migration's own
       * notes say to lock them the moment anything reads them for
       * entitlement — at which point a user-session write would start
       * failing silently exactly like the `plan` write did. */
      const { error: pendingWriteError } = await admin
        .from("profiles")
        .update({
          pending_plan: plan,
          pending_plan_effective_at: new Date(periodEndUnix * 1000).toISOString(),
        })
        .eq("id", user.id);
      if (pendingWriteError) {
        // PostgrestError isn't an Error instance, so logApiError would log
        // message:"unknown" — pass the text through `extra`.
        logApiError("billing.changePlan.pendingPlanWrite", pendingWriteError, {
          plan,
          detail: pendingWriteError.message,
        });
      }
      return NextResponse.json({
        scheduled: true,
        effective: new Date(periodEndUnix * 1000).toISOString(),
        plan,
        // The Stripe schedule is what actually defers the downgrade; these
        // two columns are display-only, so a failed write is reported, not
        // fatal.
        synced: !pendingWriteError,
      });
    }

    // Upgrades apply immediately (contractor wants their new ZIPs now).
    await stripe.subscriptions.update(activeSub.id, {
      items: [{ id: firstItem.id, price: PLAN_PRICES[plan] }],
      proration_behavior: "create_prorations",
    });

    /* Service-role write, and the error is checked.
     *
     * 2026-08-04: this was `await supabase.from("profiles").update({ plan })`
     * on the USER'S session with no error destructure. Migration 00117 added
     * a BEFORE UPDATE guard that raises 42501 when a session rewrites `plan`
     * while `stripe_subscription_id` is set — i.e. on every upgrade this
     * route handles. The write therefore always failed, the failure was
     * invisible, and the route 200'd while the contractor's ZIP cap stayed
     * on the old tier until the customer.subscription.updated webhook landed
     * (00117's own header documents this as a known follow-up). 00117 exempts
     * service_role, so the admin client makes the entitlement correct on the
     * response instead of seconds later.
     *
     * On failure we still return 200: Stripe has already moved the
     * subscription, so reporting "upgrade failed" would be false and would
     * invite a retry loop. `synced: false` lets the client soften its
     * confirmation copy, and logApiError surfaces it to Sentry. */
    const { error: planWriteError } = await admin
      .from("profiles")
      .update({ plan })
      .eq("id", user.id);
    if (planWriteError) {
      logApiError("billing.changePlan.planWrite", planWriteError, {
        plan,
        detail: planWriteError.message,
      });
    }
    return NextResponse.json({
      upgraded: true,
      plan,
      synced: !planWriteError,
    });
  } catch (error) {
    logApiError("billing.changePlan", error);
    return NextResponse.json(
      { error: "Failed to change plan" },
      { status: 500 },
    );
  }
}
