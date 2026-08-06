import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe/client";
import { releaseTerritory } from "@/lib/territory/ziplock";

export const dynamic = "force-dynamic";

/* ─── Price ID → plan mapping ─── */

function buildPriceMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const entries: [string | undefined, string][] = [
    [process.env.STRIPE_FOUNDER_PRICE_ID, "founder"],
    [process.env.STRIPE_STARTER_PRICE_ID, "starter"],
    [process.env.STRIPE_PRO_PRICE_ID, "pro"],
    [process.env.STRIPE_ENTERPRISE_PRICE_ID, "enterprise"],
  ];
  for (const [priceId, plan] of entries) {
    if (priceId) map[priceId] = plan;
  }
  return map;
}

function resolvePlan(priceId: string | undefined): string {
  if (!priceId) return "free";
  const map = buildPriceMap();
  return map[priceId] ?? "free";
}

/* ─── Helpers ─── */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Look up a profile by stripe_customer_id. Returns { id } or null. */
async function findProfileByCustomer(
  supabase: AdminClient,
  customerId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data;
}

/** Same lookup, plus the recorded tier-subscription pointer. Only the
 *  cancellation path needs it, so the common lookup stays narrow. */
async function findProfileWithSubscription(
  supabase: AdminClient,
  customerId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("id, stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .single();
  return data as { id: string; stripe_subscription_id: string | null } | null;
}

/**
 * Release every ZIP the contractor still holds. Returns how many were
 * released.
 *
 * `release_territory` is SECURITY DEFINER and promotes the first waitlister
 * into the freed slot; the admin (service-role) client is the only caller
 * permitted since migration 00112.
 */
async function releaseAllTerritories(
  supabase: AdminClient,
  contractorId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("territories")
    .select("zip")
    .eq("contractor_id", contractorId)
    .eq("status", "active");

  if (error) {
    logger.error("subscription ended: could not list territories to release", {
      contractorId,
      error: error.message,
    });
    return 0;
  }

  let released = 0;
  for (const row of (data ?? []) as Array<{ zip: string }>) {
    const result = await releaseTerritory(row.zip, contractorId);
    if (result.success) {
      released++;
    } else {
      logger.error("subscription ended: territory release failed", {
        contractorId,
        zip: row.zip,
        message: result.message,
      });
    }
  }
  return released;
}

/** Insert a notification for a user. */
async function notify(
  supabase: AdminClient,
  userId: string,
  type: string,
  title: string,
  message: string
) {
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    message,
    read: false,
    created_at: new Date().toISOString(),
  });
}

/** Outcome of a billing_events insert — the handlers' idempotency signal. */
type LogOutcome = "inserted" | "duplicate" | "error";

/**
 * Log a billing event and report whether the row was NEW.
 *
 * `billing_events.stripe_event_id` is UNIQUE (migration 00007), so a
 * redelivery of the same event fails the insert with SQLSTATE 23505.
 * Stripe delivers at-least-once, so every handler calls this FIRST and
 * stops on "duplicate" — the same insert-first pattern that
 * `applyReferralCreditIfEligible` below uses to make coupon issuance
 * at-most-once.
 *
 * (Until 2026-08-06 this returned nothing and never read the insert error,
 * so the comment here claimed a short-circuit that did not exist and every
 * handler re-applied its mutation on every redelivery.)
 *
 * A non-duplicate insert failure returns "error": the audit row is lost and
 * logged, but the caller still applies the event, because a broken audit
 * write must not withhold an entitlement the customer paid for.
 */
async function logBillingEvent(
  supabase: AdminClient,
  userId: string,
  stripeEventId: string,
  eventType: string,
  amount: number | null,
  currency: string,
  metadata?: Record<string, unknown>
): Promise<LogOutcome> {
  const { error } = await supabase.from("billing_events").insert({
    user_id: userId,
    stripe_event_id: stripeEventId,
    event_type: eventType,
    amount,
    currency,
    metadata: metadata ?? null,
    created_at: new Date().toISOString(),
  });

  if (!error) return "inserted";

  if (error.code === "23505") {
    logger.info("Stripe webhook redelivery ignored", { stripeEventId, eventType });
    return "duplicate";
  }

  logger.error("billing_events insert failed", {
    stripeEventId,
    eventType,
    error: error.message,
  });
  return "error";
}

/* ─── Event handlers ─── */

async function handleCheckoutCompleted(
  supabase: AdminClient,
  session: Stripe.Checkout.Session,
  stripeEventId: string
) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const userId = session.metadata?.user_id;

  if (!userId) {
    logger.error("checkout.session.completed: missing user_id in metadata", { sessionId: session.id });
    return;
  }

  /* Add-on sessions (e.g. the extra-ZIP subscription) carry no `plan` in
   * metadata. Letting them through rewrote the profile's plan to the `?? "pro"`
   * default AND repointed stripe_subscription_id at the add-on, orphaning the
   * customer's real tier subscription — after which billing-sync re-stamped
   * the wrong plan nightly. Add-ons must never touch plan or the pointer. */
  if (session.metadata?.addon) {
    logger.info("checkout.session.completed: add-on session, plan untouched", {
      sessionId: session.id,
      addon: session.metadata.addon,
      userId,
    });
    return;
  }

  // Determine plan + trial end from the subscription. Retrieve the
  // subscription so we capture `trial_end` — the TopBar billing pill and
  // the trial-ending-reminder cron both depend on profiles.trial_ends_at.
  let plan: string = session.metadata?.plan ?? "pro";
  let trialEndsAt: string | null = null;
  // False when the retrieve below failed, i.e. we learned NOTHING about the
  // trial. Distinct from `trialEndsAt === null`, which means "retrieved, and
  // this subscription genuinely has no trial".
  let trialKnown = false;

  if (subscriptionId) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = sub.items.data[0]?.price?.id;
      const resolved = resolvePlan(priceId);
      if (resolved !== "free") plan = resolved;
      // trial_end is a Unix timestamp (seconds). Null when the sub didn't
      // use a trial. Stored as ISO timestamptz in profiles.
      trialEndsAt = sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null;
      trialKnown = true;
    } catch (err) {
      /* Retrieval failed — fall back to the metadata plan and leave
       * trial_ends_at ALONE (see the patch below). Writing null here was
       * wrong twice over: Stripe does not order deliveries, so it could
       * erase a value customer.subscription.created had already written,
       * and /api/checkout reads that column to decide `alreadyTrialed` —
       * a null there mints a SECOND 24-hour free trial on the customer's
       * next checkout. Error, not warn: this is a revenue leak, not noise. */
      logger.error(
        "checkout.session.completed: subscription retrieve failed; plan from metadata, trial_ends_at left untouched",
        { subscriptionId, userId, error: String(err) },
      );
    }
  }

  // IDEMPOTENCY: write the billing_events row FIRST and stop if Stripe has
  // already delivered this event. `stripe_event_id` is UNIQUE, so the second
  // delivery loses the insert race and returns "duplicate" — that is the only
  // thing standing between an at-least-once webhook and a double-applied
  // profile mutation.
  const logged = await logBillingEvent(
    supabase,
    userId,
    stripeEventId,
    "checkout_completed",
    null,
    "usd",
    { plan, subscription_id: subscriptionId }
  );
  if (logged === "duplicate") return;

  const patch: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    plan,
    updated_at: new Date().toISOString(),
  };
  if (trialKnown) patch.trial_ends_at = trialEndsAt;

  await supabase.from("profiles").update(patch).eq("id", userId);
}

/**
 * `customer.subscription.trial_will_end` fires ~3 days before the trial
 * would convert. For our 24-hour trial, it actually fires almost
 * immediately after checkout — Stripe batches these nightly and the
 * trial-is-1-day edge case means it arrives ≥12h before conversion.
 * Good enough for a "trial ending soon" reminder.
 */
async function handleTrialWillEnd(
  supabase: AdminClient,
  subscription: Stripe.Subscription,
  stripeEventId: string,
) {
  const customerId = subscription.customer as string;
  const profile = await findProfileByCustomer(supabase, customerId);
  if (!profile) return;

  // Log first, notify second: a redelivery must not send the reminder twice.
  const logged = await logBillingEvent(
    supabase,
    profile.id,
    stripeEventId,
    "trial_will_end",
    null,
    "usd",
    { subscription_id: subscription.id, trial_end: subscription.trial_end },
  );
  if (logged === "duplicate") return;

  await notify(
    supabase,
    profile.id,
    "trial_will_end",
    "Trial ending soon",
    "Your free trial ends soon. We'll charge your saved card to continue service — cancel anytime in Settings → Billing.",
  );
}

async function handleSubscriptionUpdated(
  supabase: AdminClient,
  subscription: Stripe.Subscription,
  stripeEventId: string
) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price?.id;
  const status = subscription.status;

  const profile = await findProfileByCustomer(supabase, customerId);
  if (!profile) {
    logger.error("customer.subscription.updated: no profile for customer", { customerId });
    return;
  }

  /* Log first, mutate second (moved here from the end of the function on
   * 2026-08-06). Stripe delivers at-least-once and the unique
   * stripe_event_id is the only thing that can tell a redelivery apart from
   * a genuine second update, so it has to be consulted BEFORE the plan
   * write and the notification, not after. Side effect of the move: the
   * unrecognized-price branch below now leaves an audit row where it
   * previously left none. */
  const logged = await logBillingEvent(
    supabase,
    profile.id,
    stripeEventId,
    "subscription_updated",
    null,
    "usd",
    { status, price_id: priceId }
  );
  if (logged === "duplicate") return;

  if (status === "active" || status === "trialing") {
    // Subscription is healthy -- resolve plan from price
    const plan = resolvePlan(priceId);

    /* Never coerce an unrecognized price to "free". `resolvePlan` returns
     * "free" both for a genuine free account and for any price outside the
     * four tier price IDs — including the extra-ZIP add-on. Writing that
     * through zeroed a paying customer's ZIP cap while Stripe kept charging
     * them. Log it and leave the plan alone so a misconfigured price ID
     * surfaces rather than silently downgrading someone. */
    if (plan === "free" && priceId) {
      logger.warn(
        "customer.subscription.updated: unrecognized price, plan left unchanged",
        { customerId, priceId, subscriptionId: subscription.id },
      );
      return;
    }

    // Build the update. If the incoming plan matches the profile's
    // `pending_plan` (i.e., a scheduled downgrade has landed), clear it.
    const patch: Record<string, unknown> = {
      plan,
      updated_at: new Date().toISOString(),
    };
    // Refresh trial_ends_at too — Stripe may extend or terminate trials
    // independently, and the TopBar pill renders from this field.
    if (subscription.trial_end) {
      patch.trial_ends_at = new Date(subscription.trial_end * 1000).toISOString();
    } else if (status === "active") {
      // Converted out of trial.
      patch.trial_ends_at = null;
    }

    // Read pending_plan to decide whether to clear the scheduled change.
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("pending_plan")
      .eq("stripe_customer_id", customerId)
      .single();
    if (currentProfile?.pending_plan === plan) {
      patch.pending_plan = null;
      patch.pending_plan_effective_at = null;
    }

    await supabase
      .from("profiles")
      .update(patch)
      .eq("stripe_customer_id", customerId);
  } else if (status === "past_due") {
    // Payment trouble but not terminal -- keep current plan, warn user
    await notify(
      supabase,
      profile.id,
      "payment_failed",
      "Payment Past Due",
      "Your subscription payment is past due. Please update your payment method to avoid losing access."
    );
  } else if (status === "canceled" || status === "unpaid") {
    // Subscription is no longer valid -- revert to free, pause leads
    await supabase
      .from("profiles")
      .update({
        plan: "free",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_customer_id", customerId);

    await notify(
      supabase,
      profile.id,
      "subscription_updated",
      "Subscription Inactive",
      "Your subscription is no longer active. Resubscribe to continue receiving leads."
    );
  }
}

async function handleSubscriptionDeleted(
  supabase: AdminClient,
  subscription: Stripe.Subscription,
  stripeEventId: string
) {
  const customerId = subscription.customer as string;

  const profile = await findProfileWithSubscription(supabase, customerId);
  if (!profile) {
    logger.error("customer.subscription.deleted: no profile for customer", { customerId });
    return;
  }

  const logged = await logBillingEvent(
    supabase,
    profile.id,
    stripeEventId,
    "subscription_deleted",
    null,
    "usd"
  );
  if (logged === "duplicate") return;

  /* Not every subscription on a customer is the tier subscription — the
   * extra-ZIP add-on (/api/billing/extra-zip) is a second one. Ending the
   * add-on must not revoke the plan. Treat this as the tier subscription
   * when EITHER its price is one of the four tier prices OR the profile
   * points at it; if the pointer is missing entirely, nothing else claims
   * to be the tier subscription, so the cancellation is terminal. */
  const cancelledPriceId = subscription.items.data[0]?.price?.id;
  const isTierPrice = resolvePlan(cancelledPriceId) !== "free";
  const pointsAtThisSub = profile.stripe_subscription_id === subscription.id;
  if (profile.stripe_subscription_id && !pointsAtThisSub && !isTierPrice) {
    logger.info("customer.subscription.deleted: non-tier subscription ended, entitlement untouched", {
      customerId,
      subscriptionId: subscription.id,
      priceId: cancelledPriceId,
    });
    return;
  }

  /* Revert entitlement. No data is deleted.
   *
   * `stripe_subscription_id` is cleared alongside `plan` (2026-08-06). It
   * used to survive cancellation, which left the account looking paid to
   * every gate that reads it — /api/territories' 402 check, claim_territory
   * (00113), the enrichment priority ranking, and the TopBar pill — and
   * blocked /api/checkout's already_subscribed guard from ever letting them
   * resubscribe. */
  await supabase
    .from("profiles")
    .update({
      plan: "free",
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  /* Release the ZIPs. Exclusivity is what the other contractors are paying
   * for: `leads_select_own` has no plan predicate, so a cancelled account
   * that keeps its territories keeps receiving leads AND keeps those ZIP
   * slots (3 per ZIP) locked away from paying contractors indefinitely. */
  const released = await releaseAllTerritories(supabase, profile.id);

  await notify(
    supabase,
    profile.id,
    "subscription_updated",
    "Subscription Canceled",
    released > 0
      ? `Your subscription has ended and your ${released} ZIP ${released === 1 ? "territory has" : "territories have"} been released. Resubscribe to claim territories again.`
      : "Your subscription has ended. Resubscribe to continue receiving leads."
  );
}

async function handlePaymentFailed(
  supabase: AdminClient,
  invoice: Stripe.Invoice,
  stripeEventId: string
) {
  const customerId = invoice.customer as string;

  const profile = await findProfileByCustomer(supabase, customerId);
  if (!profile) {
    logger.error("invoice.payment_failed: no profile for customer", { customerId });
    return;
  }

  /* Record the failure and warn the contractor. Nothing is paused here:
   * access follows the Stripe subscription status, which stays `past_due`
   * (handled in handleSubscriptionUpdated) until Stripe's own retry
   * schedule gives up and emits customer.subscription.deleted.
   *
   * The metadata used to carry `grace_period: true` and the comment claimed
   * "the billing-sync cron and lead delivery logic can check for recent
   * payment_failed events to enforce the grace period". Neither did — the
   * flag had no reader anywhere in the repo, so it described a feature that
   * did not exist. Dropped rather than left as a false marker. */
  const logged = await logBillingEvent(
    supabase,
    profile.id,
    stripeEventId,
    "payment_failed",
    invoice.amount_due ?? null,
    invoice.currency ?? "usd",
    { invoice_id: invoice.id }
  );
  if (logged === "duplicate") return;

  await notify(
    supabase,
    profile.id,
    "payment_failed",
    "Payment Failed",
    "Your payment failed. Please update your payment method."
  );
}

async function handlePaymentSucceeded(
  supabase: AdminClient,
  invoice: Stripe.Invoice,
  stripeEventId: string
) {
  const customerId = invoice.customer as string;

  const profile = await findProfileByCustomer(supabase, customerId);
  if (!profile) return;

  // Log first: a redelivery must not re-notify or re-run the referral
  // credit below.
  const logged = await logBillingEvent(
    supabase,
    profile.id,
    stripeEventId,
    "payment_succeeded",
    invoice.amount_paid ?? null,
    invoice.currency ?? "usd",
    { invoice_id: invoice.id }
  );
  if (logged === "duplicate") return;

  await notify(
    supabase,
    profile.id,
    "billing_alert",
    "Payment Received",
    "Payment received. Thank you!"
  );

  // Phase 1.4: 13th-month-free referral credit
  // ─────────────────────────────────────────
  // When the referee's FIRST invoice clears, apply a 1-month-free
  // Stripe coupon to the referrer's subscription. Idempotent via the
  // unique (referrer_id, referee_id) constraint on referral_credits
  // (migration 00046). Re-deliveries of the same invoice are silently
  // ignored. Wrapped in try/catch so a failure never blocks the
  // payment-confirmation flow.
  await applyReferralCreditIfEligible(supabase, profile, invoice).catch((err) => {
    logger.error("Referral credit application failed", {
      profileId: profile.id,
      invoiceId: invoice.id,
      error: String(err),
    });
  });
}

/**
 * If this paying customer was referred by another contractor AND this
 * is their first paid invoice, create a 1-month-free Stripe coupon and
 * apply it to the referrer's subscription. Idempotent.
 *
 * Phase 1.4 of the post-audit roadmap. Foundation already shipped via
 * migration 00015 (`referrals` + `referred_by` column). This adds the
 * payment-side wiring.
 */
async function applyReferralCreditIfEligible(
  supabase: AdminClient,
  refereeProfile: { id: string },
  invoice: Stripe.Invoice,
): Promise<void> {
  // Look up the referrer chain. `referred_by` was populated at signup
  // by `process_referral_signup` (migration 00015's RPC).
  const { data: row } = await supabase
    .from("profiles")
    .select("id, referred_by")
    .eq("id", refereeProfile.id)
    .single();
  if (!row?.referred_by) return; // not referred — nothing to credit

  // Idempotency check: only credit on FIRST paid invoice. Subsequent
  // invoices for this referee shouldn't re-fire the credit.
  const { count: prior } = await supabase
    .from("referral_credits")
    .select("id", { count: "exact", head: true })
    .eq("referee_id", refereeProfile.id);
  if (prior && prior > 0) return;

  // Look up the referrer's Stripe customer.
  const { data: referrerProfile } = await supabase
    .from("profiles")
    .select("id, stripe_customer_id")
    .eq("id", row.referred_by)
    .single();
  if (!referrerProfile?.stripe_customer_id) return;

  // Audit B3 fix (2026-04-27): RACE-SAFE coupon issuance.
  //
  // The prior order was (1) check count → (2) create Stripe coupon →
  // (3) apply to subscription → (4) insert referral_credits row.
  // Stripe webhooks deliver at-least-once. A retried delivery within
  // 50–200 ms passed both count checks, both `stripe.coupons.create`
  // succeeded, and both `subscriptions.update` calls succeeded —
  // attaching TWO 100%-off coupons to the same customer's next invoice.
  // The unique constraint on `referral_credits(referrer_id, referee_id)`
  // blocked the second INSERT but the duplicate coupon was already
  // attached.
  //
  // New order: INSERT the row FIRST with a placeholder coupon_id. If
  // the unique constraint blocks (concurrent delivery already won the
  // race), abort cleanly. Only on successful insert do we create the
  // Stripe coupon and update the row with the real coupon_id. This
  // makes the unique-constraint the bottleneck for at-most-once,
  // exactly the property Stripe's at-least-once delivery requires.
  const placeholderCouponId = `pending_${refereeProfile.id.slice(0, 8)}_${Date.now()}`;
  const { data: insertedRow, error: insertErr } = await supabase
    .from("referral_credits")
    .insert({
      referrer_id: row.referred_by,
      referee_id: refereeProfile.id,
      stripe_invoice_id: invoice.id,
      stripe_coupon_id: placeholderCouponId,
    })
    .select("id")
    .single();
  if (insertErr || !insertedRow) {
    // Concurrent delivery won the race (or another error). Either way,
    // exit before creating the Stripe coupon — the other delivery
    // already issued one.
    return;
  }

  const stripe = getStripe();

  // Create the 1-month-free coupon. `duration: "once"` means it applies
  // to a single billing cycle (the referrer's NEXT invoice).
  const coupon = await stripe.coupons.create({
    duration: "once",
    percent_off: 100,
    name: `Henri referral — ${refereeProfile.id.slice(0, 8)}`,
  });

  // Apply to the referrer's active subscription. If they have no active
  // subscription (cancelled, paused), the coupon is created but not
  // attached — they'll get it next time they subscribe.
  const subs = await stripe.subscriptions.list({
    customer: referrerProfile.stripe_customer_id,
    status: "active",
    limit: 1,
  });
  if (subs.data[0]) {
    // Stripe API v2025+: applying a coupon directly to a subscription
    // via update is the canonical pattern. The Stripe TS types for
    // subscription.update don't always reflect every available field;
    // the cast through unknown threads the coupon application without
    // disabling no-explicit-any project-wide.
    await stripe.subscriptions.update(subs.data[0].id, {
      coupon: coupon.id,
    } as unknown as Stripe.SubscriptionUpdateParams);
  }

  // Update the row with the real Stripe coupon id. We held the unique
  // slot with the placeholder; now stamp the truth.
  await supabase
    .from("referral_credits")
    .update({ stripe_coupon_id: coupon.id })
    .eq("id", insertedRow.id);

  // Best-effort notification to the referrer. Non-fatal on failure.
  try {
    await notify(
      supabase,
      row.referred_by,
      "billing_alert",
      "Referral credit applied",
      "Your referee just paid their first invoice — your next bill is on the house.",
    );
  } catch {
    // notify failures are logged inside notify(); swallow here.
  }
}

/* ─── POST /api/webhooks/stripe ─── */

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Webhook signature verification failed", { error: message });
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(supabase, session, event.id);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        // Handle both — Stripe fires `created` on initial checkout but we
        // also get `checkout.session.completed`. The `updated` handler is
        // idempotent and writes trial_ends_at + clears pending_plan.
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(supabase, subscription, event.id);
        break;
      }

      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleTrialWillEnd(supabase, subscription, event.id);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription, event.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabase, invoice, event.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(supabase, invoice, event.id);
        break;
      }

      default:
        logger.info("Unhandled Stripe event type", { eventType: event.type });
    }
  } catch (err) {
    // Log but still return 200 so Stripe doesn't retry endlessly.
    // The billing-sync cron will catch any drift.
    logger.error("Stripe webhook handler error", { eventType: event.type, error: String(err) });
  }

  return NextResponse.json({ received: true });
}
