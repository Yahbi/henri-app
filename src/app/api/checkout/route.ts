import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, getStripe } from "@/lib/stripe/client";
import { CheckoutBodySchema, parseBody } from "@/lib/schemas/api";
import { logApiError } from "@/lib/log";
import { requireContractor } from "@/lib/auth/requireContractor";

/* Plan → Stripe Price ID mapping (set STRIPE_*_PRICE_ID in your environment) */
const PLAN_PRICES: Record<string, string> = {
  founder: process.env.STRIPE_FOUNDER_PRICE_ID ?? "",
  starter: process.env.STRIPE_STARTER_PRICE_ID ?? "",
  pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "",
};

/* POST /api/checkout — create a Stripe checkout session */
export async function POST(req: NextRequest) {
  try {
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => null);
    const body = parseBody(CheckoutBodySchema, raw);
    if (body.response) return body.response;
    const { plan } = body.data;

    if (!PLAN_PRICES[plan]) {
      return NextResponse.json({ error: "Plan unavailable" }, { status: 400 });
    }

    /* Resolve the return URLs BEFORE any Stripe write. Never the
     * user-controlled Origin header (an attacker-set Origin would redirect
     * the contractor to a hostile domain right after payment).
     *
     * The `?? "http://localhost:3000"` fallback used to apply in production
     * too, so an unset NEXT_PUBLIC_APP_URL silently handed Stripe a
     * localhost success_url — the contractor was charged and then bounced to
     * a dead address with no way back into onboarding. Fail before creating
     * a Stripe customer instead. The localhost default is kept for dev,
     * where it is the correct value. */
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");
    if (!appUrl) {
      logApiError(
        "checkout.create",
        new Error("NEXT_PUBLIC_APP_URL is not set; refusing to start checkout"),
      );
      return NextResponse.json(
        { error: "Checkout is temporarily unavailable. Please contact support." },
        { status: 500 },
      );
    }

    /* Get or create Stripe customer ID */
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, stripe_subscription_id, trial_ends_at, email")
      .eq("id", user.id)
      .single();

    /* Duplicate-subscription guard.
     *
     * `mode: "subscription"` creates an ADDITIONAL subscription every time
     * it is called — Stripe does not dedupe, and the webhook overwrites
     * profiles.stripe_subscription_id so the first one becomes invisible to
     * the app while still billing. The onboarding funnel walks straight back
     * here (dashboard -> license -> plan -> payment) for any contractor who
     * paid but abandoned territory selection, so this is reachable by
     * construction, not just by browser-history replay.
     *
     * The dashboard billing page already routes subscribed users through
     * /api/billing/change-plan for exactly this reason; enforce the same
     * rule server-side so no client can bypass it. */
    let customerId = profile?.stripe_customer_id;

    if (profile?.stripe_subscription_id) {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message:
            "You already have an active subscription. Use billing settings to change your plan.",
          change_plan_endpoint: "/api/billing/change-plan",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    /* Belt-and-suspenders: the profile pointer can be stale if a webhook was
     * missed, so ask Stripe directly before minting a session. Stripe is the
     * authority on both questions asked here — whether a live subscription
     * already exists, and whether this customer has ever consumed the
     * 24-hour trial. */
    let stripeShowsPriorTrial = false;
    if (customerId) {
      try {
        const existing = await getStripe().subscriptions.list({
          customer: customerId,
          // `status: "all"` (was "active", limit 1). Two reasons: a
          // `trialing` subscription is live and was NOT matched by the old
          // filter, and the trial check below has to see cancelled
          // subscriptions — that is exactly the customer who comes back for
          // a second free day.
          status: "all",
          limit: 100,
        });
        if (existing.data.some((s) => s.status === "active" || s.status === "trialing")) {
          return NextResponse.json(
            {
              error: "already_subscribed",
              message:
                "You already have an active subscription. Use billing settings to change your plan.",
              change_plan_endpoint: "/api/billing/change-plan",
            },
            { status: 409, headers: { "Cache-Control": "no-store" } }
          );
        }
        stripeShowsPriorTrial = existing.data.some(
          (s) => s.trial_start !== null || s.trial_end !== null,
        );
      } catch (err) {
        /* Never fail the checkout on a Stripe read error — the
         * stripe_subscription_id check above is the primary guard, and
         * profiles.trial_ends_at still backs the trial check below. */
        logApiError("checkout.subscriptionLookup", err);
      }
    }

    if (!customerId) {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email: profile?.email ?? user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Return URLs (2026-06-10 journey fix): both previously pointed at
    // /dashboard, but middleware bounces not-yet-onboarded contractors
    // from /dashboard back to /onboarding/license — so a user who had
    // just paid landed on a blank license form with their progress
    // apparently lost, and never reached the territory step. Success now
    // continues the actual flow (territory claim); cancel returns to the
    // payment step so they can retry or pick another plan.
    /* One trial per account, decided from BOTH sources.
     *
     * `trial_ends_at` is stamped by the checkout.session.completed webhook.
     * Reading it alone made the trial gate depend on that single delivery:
     * when the webhook was missed — or its subscriptions.retrieve threw, so
     * the column stayed null — this read false and Stripe minted a SECOND
     * 24-hour free trial on every subsequent checkout. Stripe's own
     * subscription history closes that, since a consumed trial leaves
     * trial_start/trial_end set on the old subscription forever. */
    const alreadyTrialed = Boolean(profile?.trial_ends_at) || stripeShowsPriorTrial;

    const session = await createCheckoutSession(
      PLAN_PRICES[plan],
      customerId,
      `${appUrl}/onboarding/territory?checkout=success`,
      `${appUrl}/onboarding/payment?checkout=cancelled`,
      { user_id: user.id, plan },
      { skipTrial: alreadyTrialed }
    );

    return NextResponse.json(
      { url: session.url },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logApiError("checkout.create", error);
    return NextResponse.json({ error: "Failed to create checkout" }, { status: 500 });
  }
}
