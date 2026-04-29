import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/client";
import { logApiError } from "@/lib/log";
import { ExtraZipBodySchema, parseBody } from "@/lib/schemas/api";

/**
 * POST /api/billing/extra-zip
 * Body (optional): { quantity?: number }   (default 1)
 *
 * Creates a Stripe Checkout session for the Extra ZIP add-on ($19/mo per
 * ZIP). If the contractor already has an active base subscription, the
 * session attaches the new line item to it; otherwise checkout behaves
 * as a standalone subscription (unusual but handled).
 *
 * Replaces the old flow where the "Add Territory" button linked to
 * /onboarding/territory — no actual billing change was triggered.
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ExtraZipBodySchema, raw);
    if (parsed.response) return parsed.response;
    /* Schema clamps to 1..100; default to 1 when omitted. */
    const quantity = parsed.data.quantity ?? 1;

    const priceId = process.env.STRIPE_EXTRA_ZIP_PRICE_ID;
    if (!priceId) {
      return NextResponse.json(
        { error: "Extra-ZIP price not configured" },
        { status: 500 },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    const stripe = getStripe();
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity }],
      success_url: `${appUrl}/settings/billing?addon=success`,
      cancel_url: `${appUrl}/settings/billing?addon=cancelled`,
      allow_promotion_codes: true,
      metadata: {
        user_id: user.id,
        addon: "extra_zip",
        quantity: String(quantity),
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          addon: "extra_zip",
          quantity: String(quantity),
        },
      },
    });

    return NextResponse.json(
      { url: session.url },
      { headers: { "Cache-Control": "no-store" } },
    );
    void req;
  } catch (error) {
    logApiError("billing.extraZip", error);
    return NextResponse.json(
      { error: "Failed to start extra-ZIP checkout" },
      { status: 500 },
    );
  }
}
