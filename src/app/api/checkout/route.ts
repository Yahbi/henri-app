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
    const raw = await req.json();
    const body = parseBody(CheckoutBodySchema, raw);
    if (body.response) return body.response;
    const { plan } = body.data;

    if (!PLAN_PRICES[plan]) {
      return NextResponse.json({ error: "Plan unavailable" }, { status: 400 });
    }

    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    /* Get or create Stripe customer ID */
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

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
    const session = await createCheckoutSession(
      PLAN_PRICES[plan],
      customerId,
      `${appUrl}/dashboard?checkout=success`,
      `${appUrl}/dashboard?checkout=cancelled`,
      { user_id: user.id, plan }
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
