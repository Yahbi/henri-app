import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBillingPortalSession } from "@/lib/stripe/client";
import { logApiError } from "@/lib/log";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session so the contractor can manage
 * their subscription (update card, cancel, change plan, download invoices)
 * directly in Stripe's hosted UI. `settings/billing/page.tsx` POSTs here
 * from both the "Manage Billing" button and the cancellation flow.
 *
 * Flow:
 *   1. Authenticate the user via server Supabase client
 *   2. Look up their stripe_customer_id from profiles (created on first
 *      checkout in /api/checkout/route.ts)
 *   3. Create a portal session scoped to that customer
 *   4. Return { url } for the client to redirect to
 *
 * No request body — customer ID is derived from the session. The `return_url`
 * sends the user back to the billing page after they're done.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      // No customer record yet — the user hasn't hit checkout. Prompt the
      // client to send them through checkout first.
      return NextResponse.json(
        { error: "No billing account found. Please complete checkout first." },
        { status: 400 },
      );
    }

    // Send the user back to the billing settings page after they finish
    // in Stripe's portal. Use the configured app URL (not the request
    // Origin) to prevent post-portal redirects to attacker-controlled hosts.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await createBillingPortalSession(
      profile.stripe_customer_id,
      `${appUrl}/settings/billing`,
    );

    return NextResponse.json(
      { url: session.url },
      { headers: { "Cache-Control": "no-store" } },
    );
    // Reference req to silence lint (POST handler must accept NextRequest).
    void req;
  } catch (error) {
    logApiError("billing.portal", error);
    return NextResponse.json(
      { error: "Failed to open billing portal" },
      { status: 500 },
    );
  }
}
