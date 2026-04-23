import Stripe from "stripe";
import { getEnv } from "@/lib/env";

/**
 * Centralized Stripe client factory — all server code that needs a Stripe
 * client should call this rather than `new Stripe(process.env.…!)`. This keeps
 * the secret-key access path in one place and gives dev-mode env validation
 * from getEnv().
 */
export function getStripe() {
  return new Stripe(getEnv().stripeSecretKey, {
    apiVersion: "2026-03-25.dahlia",
  });
}

export async function createCheckoutSession(
  priceId: string,
  customerId: string,
  successUrl: string,
  cancelUrl: string,
  metadata?: Record<string, string>
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    metadata: metadata ?? {},
    // 24-hour free trial per the pricing page ("24-hour free trial, credit
    // card required"). Stripe enforces the card on file at checkout and
    // only charges after the trial elapses.
    subscription_data: {
      trial_period_days: 1,
      metadata: metadata ?? {},
    },
  });

  return session;
}

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}
