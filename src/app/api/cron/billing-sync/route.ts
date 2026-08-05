import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 120;

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

    await logCronRun("billing-sync", t0, {
      pulled: (profiles ?? []).length,
      inserted: updated,
      summary: { synced, updated, issues, hitDeadline: deadlineExceeded() },
      trigger: detectTrigger(request),
    });

    return NextResponse.json({
      success: true,
      synced,
      updated,
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
