import Stripe from "stripe";

/**
 * Centralized Stripe client factory — all server code that needs a Stripe
 * client should call this rather than `new Stripe(process.env.…!)`.
 *
 * 2026-06-17 fix: this used to read `getEnv().stripeSecretKey`, but getEnv()
 * eagerly validates ~18 unrelated vars (Twilio, OpenAI, Mapbox) and THROWS in
 * production if any is missing. With Twilio unprovisioned, that killed every
 * Stripe path (checkout, billing-sync, change-plan, extra-zip, and the
 * webhook) before they did anything — billing-sync errored on a missing
 * TWILIO_ACCOUNT_SID every run. Read only STRIPE_SECRET_KEY here so Stripe
 * never depends on unrelated subsystems being configured.
 */
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("[Henri] STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, {
    apiVersion: "2026-03-25.dahlia",
  });
}

export interface CheckoutSessionOptions {
  /** Omit the 24-hour trial — set when this customer already consumed one.
   *  Without it every repeat checkout mints another free day. */
  skipTrial?: boolean;
}

export async function createCheckoutSession(
  priceId: string,
  customerId: string,
  successUrl: string,
  cancelUrl: string,
  metadata?: Record<string, string>,
  options?: CheckoutSessionOptions
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
    // only charges after the trial elapses. The trial is per-account, not
    // per-checkout: callers pass `skipTrial` once the customer has had one.
    subscription_data: {
      ...(options?.skipTrial ? {} : { trial_period_days: 1 }),
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
