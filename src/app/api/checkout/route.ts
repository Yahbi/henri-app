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
     * missed, so ask Stripe directly before minting a session. */
    if (customerId) {
      try {
        const existing = await getStripe().subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        if (existing.data.length > 0) {
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
      } catch (err) {
        /* Never fail the checkout on a Stripe read error — the
         * stripe_subscription_id check above is the primary guard. */
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

    // Use only the configured app URL — never the user-controlled Origin header
    // (prevents attacker-set Origin redirecting post-payment to malicious domain).
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // Return URLs (2026-06-10 journey fix): both previously pointed at
    // /dashboard, but middleware bounces not-yet-onboarded contractors
    // from /dashboard back to /onboarding/license — so a user who had
    // just paid landed on a blank license form with their progress
    // apparently lost, and never reached the territory step. Success now
    // continues the actual flow (territory claim); cancel returns to the
    // payment step so they can retry or pick another plan.
    /* One trial per account. `trial_ends_at` is stamped by the
     * checkout.session.completed webhook, so a customer who already consumed
     * the 24-hour trial (then cancelled and returned) does not get a fresh
     * free day on every subsequent checkout. */
    const alreadyTrialed = Boolean(profile?.trial_ends_at);

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
