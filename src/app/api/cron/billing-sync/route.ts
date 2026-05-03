import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

/* Shared handler — Vercel Cron sends GET; manual triggers can use POST */
async function handler(request: NextRequest): Promise<NextResponse> {
  /* Validate CRON_SECRET bearer token */
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const STRIPE_TO_PLAN: Record<string, string> = {
      [process.env.STRIPE_FOUNDER_PRICE_ID ?? "___"]: "founder",
      [process.env.STRIPE_STARTER_PRICE_ID ?? "___"]: "starter",
      [process.env.STRIPE_PRO_PRICE_ID ?? "___"]: "pro",
      [process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "___"]: "enterprise",
    };

    for (const profile of profiles ?? []) {
      try {
        const sub = await stripe.subscriptions.retrieve(
          profile.stripe_subscription_id as string
        );
        synced++;

        const priceId = sub.items.data[0]?.price?.id ?? "";
        const stripePlan = STRIPE_TO_PLAN[priceId] ?? "starter";

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
    return NextResponse.json(
      { error: "Cron job failed", detail: errMsg },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
