import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 120;

/* Bound for the Stripe-side sweep below: at most this many pages of 100
 * subscriptions per status. 5 × 100 × 2 statuses = 1,000 live subscriptions
 * per run, well past current volume, and the loop also stops on the shared
 * 110s deadline. */
const SWEEP_MAX_PAGES = 5;
const SWEEP_PAGE_SIZE = 100;

type AdminClient = ReturnType<typeof createAdminClient>;

/** Resolve a subscription's customer id + email in one shot. The list call
 *  expands `data.customer`, so no extra round-trip per subscription. */
function readCustomer(sub: Stripe.Subscription): { id: string; email: string | null } {
  if (typeof sub.customer === "string") return { id: sub.customer, email: null };
  if ("deleted" in sub.customer) return { id: sub.customer.id, email: null };
  return { id: sub.customer.id, email: sub.customer.email };
}

/** Find the single profile matching a column value. Returns null when there
 *  is no match OR more than one — an ambiguous match must never be written
 *  to, since the wrong contractor would be granted the subscription. */
async function findProfile(
  supabase: AdminClient,
  column: "stripe_customer_id" | "email",
  value: string,
) {
  const { data } = await supabase
    .from("profiles")
    .select("id, plan, stripe_customer_id, stripe_subscription_id, trial_ends_at")
    .eq(column, value)
    .limit(2);
  return data?.length === 1 ? data[0] : null;
}

/**
 * Stripe-side sweep: repair profiles that are PAYING but carry no
 * `stripe_subscription_id`.
 *
 * That column is written in exactly one place — the
 * `checkout.session.completed` webhook. If that delivery is ever missed
 * (endpoint down, signature secret rotated, handler threw before the
 * profile update), the contractor is charged but their profile stays
 * `plan = "free"` with a NULL pointer, so `/api/territories` POST 402s
 * forever. The profile-driven loop in `handler` below cannot see them
 * either: it filters on `stripe_subscription_id IS NOT NULL`, i.e. exactly
 * the rows that are already fine. Nothing else in the codebase repairs
 * this, so without this pass the state is permanent.
 *
 * Walking Stripe instead of the profiles table inverts that filter.
 * Bounded by SWEEP_MAX_PAGES and the caller's deadline. Idempotent: it
 * only writes when the pointer is NULL, so a second run is a no-op and
 * the row is then owned by the profile-driven loop.
 */
async function sweepStripeForMissingPointers(
  supabase: AdminClient,
  stripe: ReturnType<typeof getStripe>,
  priceToPlan: Record<string, string>,
  deadlineExceeded: () => boolean,
  issues: string[],
): Promise<{ scanned: number; repaired: number }> {
  let scanned = 0;
  let repaired = 0;

  for (const status of ["trialing", "active"] as const) {
    let startingAfter: string | undefined;

    for (let page = 0; page < SWEEP_MAX_PAGES; page++) {
      if (deadlineExceeded()) return { scanned, repaired };

      const batch = await stripe.subscriptions.list({
        status,
        limit: SWEEP_PAGE_SIZE,
        expand: ["data.customer"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of batch.data) {
        if (deadlineExceeded()) return { scanned, repaired };
        scanned++;

        const customer = readCustomer(sub);

        /* Match on stripe_customer_id first (stamped when the checkout
         * session is created, so it is present even when the completion
         * webhook was lost), then fall back to the customer's email. */
        let profile = await findProfile(supabase, "stripe_customer_id", customer.id);
        const matchedByEmail = !profile && !!customer.email;
        if (matchedByEmail && customer.email) {
          profile = await findProfile(supabase, "email", customer.email);
        }
        if (!profile) continue;

        // Already pointed somewhere — the profile-driven loop owns this
        // row. A different id here is normal (the extra-ZIP add-on is a
        // second subscription on the same customer), so don't touch it.
        if (profile.stripe_subscription_id) continue;

        /* Fail closed on an unrecognized price, same rule the
         * profile-driven loop applies: the extra-ZIP add-on lands here and
         * must not mint a tier entitlement. */
        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = priceToPlan[priceId];
        if (!plan) {
          issues.push(
            `Profile ${profile.id}: Stripe sub ${sub.id} has unmapped price ${priceId} — pointer left NULL`,
          );
          continue;
        }

        const patch: Record<string, unknown> = {
          stripe_subscription_id: sub.id,
          plan,
          updated_at: new Date().toISOString(),
        };
        if (!profile.stripe_customer_id) patch.stripe_customer_id = customer.id;
        // Also stamp the trial end the lost webhook would have written —
        // /api/checkout reads it to refuse a second free trial.
        if (sub.trial_end && !profile.trial_ends_at) {
          patch.trial_ends_at = new Date(sub.trial_end * 1000).toISOString();
        }

        const { error: writeError } = await supabase
          .from("profiles")
          .update(patch)
          .eq("id", profile.id);

        if (writeError) {
          issues.push(`Profile ${profile.id}: repair write failed — ${writeError.message}`);
          logger.error("billing-sync: orphan repair write failed", {
            profileId: profile.id,
            subscriptionId: sub.id,
            error: writeError.message,
          });
          continue;
        }

        repaired++;
        issues.push(
          `Profile ${profile.id}: missing subscription pointer repaired from Stripe ${sub.id} (${profile.plan} → ${plan}, matched by ${matchedByEmail ? "email" : "customer id"})`,
        );
        logger.warn("billing-sync: repaired charged-but-unentitled profile", {
          profileId: profile.id,
          subscriptionId: sub.id,
          plan,
          matchedBy: matchedByEmail ? "email" : "customer_id",
        });
      }

      if (!batch.has_more || batch.data.length === 0) break;
      startingAfter = batch.data[batch.data.length - 1]?.id;
      if (!startingAfter) break;
    }
  }

  return { scanned, repaired };
}

/* Shared handler — Vercel Cron sends GET; manual triggers can use POST */
async function handler(request: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  // Hard deadline per invocation. 110s leaves 10s headroom vs maxDuration=120.
  const deadlineMs = t0 + 110_000;
  const deadlineExceeded = () => Date.now() > deadlineMs;

  /* Validate CRON_SECRET bearer token */
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ skipped: true, reason: "Stripe not configured" });
  }

  try {
    const supabase = createAdminClient();
    const stripe = getStripe();

    /* Fetch all profiles that have a Stripe subscription */
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, stripe_customer_id, stripe_subscription_id, plan")
      .not("stripe_subscription_id", "is", null);

    if (error) throw error;

    let synced = 0;
    let updated = 0;
    const issues: string[] = [];

    /* Build the price->plan map by FILTERING unset env vars, mirroring
     * buildPriceMap() in /api/webhooks/stripe. The previous literal used a
     * `"___"` placeholder key, so two unset tier vars collided on one key
     * and whichever was computed last silently won. */
    const STRIPE_TO_PLAN: Record<string, string> = {};
    for (const [priceId, planName] of [
      [process.env.STRIPE_FOUNDER_PRICE_ID, "founder"],
      [process.env.STRIPE_STARTER_PRICE_ID, "starter"],
      [process.env.STRIPE_PRO_PRICE_ID, "pro"],
      [process.env.STRIPE_ENTERPRISE_PRICE_ID, "enterprise"],
    ] as const) {
      if (priceId) STRIPE_TO_PLAN[priceId] = planName;
    }

    for (const profile of profiles ?? []) {
      // Deadline guard: return a clean partial instead of a hard 504.
      if (deadlineExceeded()) break;
      try {
        const sub = await stripe.subscriptions.retrieve(
          profile.stripe_subscription_id as string
        );
        synced++;

        const priceId = sub.items.data[0]?.price?.id ?? "";
        const stripePlan = STRIPE_TO_PLAN[priceId];

        /* FAIL CLOSED on an unrecognized price.
         *
         * The previous `?? "starter"` fallback granted the $749 tier — and
         * its 5-ZIP territory entitlement — to any subscription whose price
         * was not one of the four configured plans. The $19 extra-ZIP add-on
         * hits exactly that path. In the reverse direction, a missing
         * STRIPE_ENTERPRISE_PRICE_ID would silently demote a real $2,555
         * customer to Starter overnight.
         *
         * Skipping leaves the profile untouched and records the price in the
         * cron summary so a misconfigured env var surfaces instead of
         * quietly rewriting entitlements. */
        if (!stripePlan) {
          issues.push(
            `Profile ${profile.id}: unmapped Stripe price ${priceId} — skipped (plan left as ${profile.plan})`,
          );
          logger.warn("billing-sync: unmapped Stripe price", {
            profileId: profile.id,
            priceId,
            currentPlan: profile.plan,
          });
          continue;
        }

        /* Map Stripe status to an active/inactive determination */
        const isActive = ["active", "trialing"].includes(sub.status);
        const correctPlan = isActive ? stripePlan : "free";

        if (profile.plan !== correctPlan) {
          updated++;
          issues.push(`Profile ${profile.id}: ${profile.plan} → ${correctPlan} (sub status: ${sub.status})`);
          await supabase
            .from("profiles")
            .update({ plan: correctPlan })
            .eq("id", profile.id);
        }
      } catch (err) {
        logger.error("Billing sync failed for profile", { profileId: profile.id, error: String(err) });
      }
    }

    /* Second pass, driven from Stripe rather than from profiles — the only
     * thing that can see a contractor who paid but whose profile never got
     * its subscription pointer. See sweepStripeForMissingPointers. */
    const sweep = await sweepStripeForMissingPointers(
      supabase,
      stripe,
      STRIPE_TO_PLAN,
      deadlineExceeded,
      issues,
    );

    await logCronRun("billing-sync", t0, {
      pulled: (profiles ?? []).length,
      inserted: updated + sweep.repaired,
      summary: {
        synced,
        updated,
        stripeScanned: sweep.scanned,
        repaired: sweep.repaired,
        issues,
        hitDeadline: deadlineExceeded(),
      },
      trigger: detectTrigger(request),
    });

    return NextResponse.json({
      success: true,
      synced,
      updated,
      stripeScanned: sweep.scanned,
      repaired: sweep.repaired,
      issues,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // 2026-05-02 audit: surface error detail in response. Generic
    // "Cron job failed" 500s show up as red chips in the data-health
    // panel with no way to debug from the UI.
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Billing sync cron error", { error: errMsg });
    await logCronRun("billing-sync", t0, {
      status: "error",
      error: errMsg,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "Cron job failed", detail: errMsg },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
