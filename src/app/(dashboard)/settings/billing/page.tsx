"use client";

import { useState } from "react";
import { Check, CreditCard, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUser } from "@/hooks/useUser";
import {
  PLAN_TIERS,
  findPlanTier,
  planFeatures,
  type PlanTier,
} from "@/lib/plans/tiers";

/* The tier lineup used to be declared inline here AND in
 * src/components/landing/PricingSection.tsx. The two lists drifted (Pro
 * carried "Compliance dashboard" on the marketing page and not here), so a
 * contractor saw a different product depending on which page they were on.
 * Both surfaces now read src/lib/plans/tiers.ts. */

export default function BillingPage() {
  const { profile, refreshProfile } = useUser();
  const [managingBilling, setManagingBilling] = useState(false);
  const [upgradingTo, setUpgradingTo] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanTier | null>(null);
  // Inline banner state — replaces the prior 4× native `alert()` dialogs
  // which were jarring on a paid dashboard. tone="success" is rendered
  // green; "error" is red; "info" is primary-tinted.
  const [banner, setBanner] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  // A cancelled / unpaid / never-subscribed contractor carries
  // plan = "free" (written by the Stripe webhook on cancel + unpaid, by
  // handleSubscriptionDeleted, by the billing-sync cron, and as the
  // profiles column DEFAULT). findPlanTier returns undefined for "free",
  // null, and anything unrecognised, so subscribed-ness is the presence of
  // a tier — never a defaulted one. The old `?? PLANS[0]` fallback rendered
  // "Founder $149/mo · 3 ZIP territories" as their CURRENT plan, a false
  // billing statement to a user whose real entitlement is zip_cap 0
  // (lib/territory/plan-caps.ts).
  const currentTier = findPlanTier(profile?.plan);
  const isSubscribed = !!currentTier;
  const currentPlanSlug = currentTier?.slug ?? "";
  // Baseline for the Upgrade/Downgrade labels. Unsubscribed means $0, so
  // every card reads "Subscribe" and never "Downgrade".
  const currentPriceNum = currentTier?.priceNum ?? 0;

  async function openBillingPortal() {
    setManagingBilling(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setManagingBilling(false);
    }
  }

  async function handleUpgrade(plan: PlanTier) {
    setConfirmPlan(null);
    setUpgradingTo(plan.slug);

    const isDowngrade = plan.priceNum < currentPriceNum;
    const isSamePlan = plan.slug === currentPlanSlug;

    // Downgrades: per CLAUDE.md policy, "territory changes: next billing
    // cycle only" — plan downgrades follow the same rule. Never charge
    // again immediately; schedule the swap at period end.
    if (isDowngrade && profile?.plan && !isSamePlan) {
      try {
        const res = await fetch("/api/billing/change-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: plan.slug }),
        });
        if (!res.ok) throw new Error();
        const j = (await res.json()) as { effective?: string };
        const whenLabel = j.effective
          ? new Date(j.effective).toLocaleDateString()
          : "at your next renewal";
        setBanner({
          tone: "success",
          text: `Downgrade to ${plan.name} scheduled. Takes effect ${whenLabel}.`,
        });
        setUpgradingTo(null);
        return;
      } catch {
        setUpgradingTo(null);
        setBanner({
          tone: "error",
          text: "Couldn't schedule the downgrade. Please retry.",
        });
        return;
      }
    }

    // Upgrades: use change-plan when already subscribed (prevents duplicate
    // Stripe subscriptions). Fall back to checkout for first-time subscribers.
    //
    // 2026-08-04 double-charge fix. This read `profile?.stripe_customer_id`,
    // a field useUser never SELECTed — so it was permanently undefined, the
    // guard never fired, and every upgrade fell through to /api/checkout,
    // which opens a SECOND concurrent Stripe subscription on the same
    // customer while the old one keeps billing. Switched to
    // `stripe_subscription_id` (now selected): the customer id is stamped at
    // checkout-session creation, i.e. before payment, so an abandoned
    // checkout would have routed a genuinely-unsubscribed user into
    // change-plan, which 400s "No active subscription". Same rule as
    // onboarding/territory/page.tsx and api/territories/route.ts.
    const hasSubscription = !!profile?.stripe_subscription_id;
    if (hasSubscription && !isSamePlan) {
      try {
        const res = await fetch("/api/billing/change-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: plan.slug }),
        });
        if (!res.ok) throw new Error();
        // `synced: false` means Stripe moved but the profile row write
        // failed, so the ZIP allowance still reads the old tier until the
        // subscription webhook reconciles. Don't promise territories that
        // aren't unlocked yet.
        const j = (await res.json()) as { synced?: boolean };
        setBanner({
          tone: "success",
          text:
            j.synced === false
              ? `Upgraded to ${plan.name}. Your new territory allowance appears in a few moments.`
              : `Upgraded to ${plan.name}. Your new territories are available immediately.`,
        });
        // Pull the new plan onto the page so the Active ribbon and the
        // Upgrade/Downgrade labels reflect the change without a reload.
        await refreshProfile();
        setUpgradingTo(null);
        return;
      } catch {
        setUpgradingTo(null);
        setBanner({
          tone: "error",
          text: "Couldn't upgrade plan. Please retry.",
        });
        return;
      }
    }

    // First-time subscriber: Stripe checkout (24-hr trial applies).
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.slug }),
      });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setUpgradingTo(null);
      setBanner({
        tone: "error",
        text: "Couldn't open checkout. Please retry.",
      });
    }
  }

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="font-heading font-normal text-2xl text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your plan and payment method</p>
      </div>

      {banner && (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          className={
            banner.tone === "success"
              // text-green-300 (#86EFAC) on the light-theme background
              // measured ~1.24:1 — effectively invisible, on the banner
              // that confirms a billing change actually went through.
              // Semantic token instead, matching the error arm below.
              ? "flex items-start justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
              : banner.tone === "error"
                ? "flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                : "flex items-start justify-between gap-3 rounded-lg border border-primary/20 bg-primary-04 px-4 py-3 text-sm text-primary"
          }
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Current plan banner — or an explicit "no active subscription"
          state. Never name a paid tier the contractor isn't on. */}
      <div
        className={cn(
          "border rounded-xl p-6",
          isSubscribed
            ? "bg-primary-04 border-primary/20"
            : "bg-warning/10 border-warning/30",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CreditCard
                className={cn("h-4 w-4", isSubscribed ? "text-primary" : "text-warning")}
              />
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  isSubscribed ? "text-primary" : "text-warning",
                )}
              >
                {isSubscribed ? "Current Plan" : "No active subscription"}
              </p>
            </div>
            {currentTier ? (
              <>
                <p className="text-2xl font-bold text-foreground">
                  {currentTier.name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">{currentTier.price}/mo</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {currentTier.territories} ZIP territories · AI-scored leads · Best-effort owner contact enrichment
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground">Not subscribed</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You can&apos;t claim territories or receive new leads without an
                  active plan. Pick one below to start.
                </p>
              </>
            )}
          </div>
          <button
            onClick={openBillingPortal}
            disabled={managingBilling}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            {managingBilling ? "Opening..." : "Manage Billing"}
          </button>
        </div>
      </div>

      {/* Plan comparison */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Compare Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLAN_TIERS.map((plan) => {
            const isCurrent = plan.slug === currentPlanSlug;
            const isUpgrading = upgradingTo === plan.slug;
            return (
              <div
                key={plan.name}
                className={cn(
                  "relative bg-card border rounded-xl p-5 flex flex-col",
                  /* Three visual states, mutually exclusive by priority:
                   *   1. isCurrent → emerald ring, muted card background
                   *   2. highlighted → terracotta ring + shadow ("Popular")
                   *   3. default → plain border
                   * Before this change, the active-plan border
                   * (primary/40) was nearly identical to the
                   * highlighted-plan border (primary) — scan-readers
                   * couldn't distinguish "my plan" from "the upsell".
                   * Using emerald for active clearly signals "locked in"
                   * rather than "featured offer". */
                  isCurrent
                    ? "border-emerald-500/40 ring-2 ring-emerald-500/20 bg-emerald-500/[0.03]"
                    : plan.popular
                      ? "border-primary ring-2 ring-primary/30 shadow-lg"
                      : "border-border"
                )}
              >
                {/* Popular ribbon — only when NOT also the current plan
                 * (avoids a ribbon pile-up if the user is on Pro). */}
                {plan.popular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 bg-cta text-cta-foreground px-2.5 py-0.5 rounded-full text-[11px] font-semibold shadow">
                      <Zap className="h-2.5 w-2.5" />
                      Popular
                    </span>
                  </div>
                )}
                {/* Active ribbon — emerald to distinguish from terracotta
                 * "Popular". Sits in the top-right corner instead of
                 * centered so the two ribbons never collide. */}
                {isCurrent && (
                  <div className="absolute -top-3 right-3">
                    <span className="inline-flex items-center gap-1 bg-emerald-500 text-white px-2.5 py-0.5 rounded-full text-[11px] font-semibold shadow">
                      <Check className="h-3 w-3" strokeWidth={3} />
                      Active
                    </span>
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                  <p className="mt-3 text-2xl font-bold text-foreground">
                    {plan.price}
                    <span className="text-sm font-normal text-muted-foreground">{plan.interval}</span>
                  </p>
                </div>

                <ul className="space-y-2 flex-1 mb-5">
                  {planFeatures(plan).map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-foreground">
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  /* Muted, non-clickable "currently active" chip rather
                   * than a button styled to look actionable. The emerald
                   * ribbon above already conveys the state; the CTA area
                   * just needs to confirm it without competing with the
                   * upgrade CTAs on adjacent cards. */
                  <div className="w-full py-2 text-center text-xs font-medium text-emerald-600 bg-emerald-500/10 rounded-lg">
                    Currently active
                  </div>
                ) : plan.slug === "enterprise" ? (
                  <a
                    href="mailto:sales@meethenri.com?subject=Enterprise inquiry"
                    className="w-full py-2 text-sm font-medium border border-border rounded-lg text-center hover:bg-accent transition-colors block"
                  >
                    Contact Sales
                  </a>
                ) : (
                  <button
                    onClick={() => setConfirmPlan(plan)}
                    disabled={!!upgradingTo}
                    className={cn(
                      "w-full py-2 text-sm font-medium rounded-lg transition-opacity disabled:opacity-50",
                      plan.popular
                        ? "bg-cta text-cta-foreground hover:opacity-90"
                        : "border border-border hover:bg-accent"
                    )}
                  >
                    {isUpgrading
                      ? "Redirecting..."
                      : !isSubscribed
                        // Never offer to "Downgrade" off a plan the user
                        // doesn't hold — with no subscription every card
                        // is a purchase.
                        ? "Subscribe"
                        : plan.priceNum > currentPriceNum
                          ? "Upgrade"
                          : "Downgrade"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add-ons section removed 2026-04-26 per user direction.
       *
       * Previously rendered an "Extra ZIP Territory ($19/mo per ZIP)"
       * add-on that POSTed to /api/billing/extra-zip. The route still
       * exists for any in-flight subscription items, but the entry
       * point is gone — contractors should change plans (Founder →
       * Starter → Pro → Enterprise) to expand their ZIP allowance,
       * not stack add-ons. Cleaner billing model. */}

      {/* Confirmation dialog */}
      {confirmPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-base font-semibold text-foreground">
              {!isSubscribed
                ? `Subscribe to ${confirmPlan.name}?`
                : `${confirmPlan.priceNum > currentPriceNum ? "Upgrade" : "Downgrade"} to ${confirmPlan.name}?`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {!isSubscribed
                ? "You'll be redirected to Stripe to start your subscription. A card is required; the 24-hour free trial applies to your first subscription. No refunds on digital products."
                : confirmPlan.priceNum > currentPriceNum
                  ? "Your plan changes immediately and your new territory allowance is available right away. Stripe prorates the difference on your existing subscription."
                  : "Your downgrade will take effect at the end of your current billing cycle. No refunds are issued; you keep full access until then."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmPlan(null)}
                className="flex-1 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpgrade(confirmPlan)}
                className="flex-1 py-2 text-sm font-medium bg-cta text-cta-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
       * Phase 0a wedge #8 — cash-flow / lock-in transparency. The
       * pricing page already carries the "flat monthly, no per-lead
       * fees" claim; this footer reminds contractors of the cancel
       * policy at the moment lock-in anxiety actually bites.
       *
       * Policy (mirrors Stripe `cancel_at_period_end: true` semantics):
       *   1. Cancel anytime from this page.
       *   2. Account stays active through the end of the current
       *      billing cycle. No partial-cycle deletion.
       *   3. After the cycle ends, the subscription terminates — no
       *      next charge, no auto-renewal — and account data is
       *      removed from active systems prior to what would have
       *      been the next billing date.
       *   4. No refunds (digital product per Terms).
       *
       * The earlier "Export your leads as JSON" line was removed
       * 2026-04-27 because the export route did not exist; restored
       * 2026-06-09 when GET /api/settings/export shipped (JSON only —
       * the no-CSV pricing rule stands).
       */}
      <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground space-y-1.5">
        <p className="text-foreground font-medium">No lock-in, ever.</p>
        <p>
          Cancel anytime from this page. Your account stays active through the
          end of your current billing cycle &mdash; no further charges occur after
          cancellation, and no auto-renewal kicks in.
        </p>
        <p>
          Flat monthly pricing. No per-lead fees, no annual contracts, no
          retention-desk phone tag.
        </p>
        <p>
          Your data is yours: download your leads, territories, and estimates
          anytime as JSON via{" "}
          <a
            href="/api/settings/export"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            data export
          </a>
          .
        </p>
        <p>
          After cancellation, your account data is removed from active systems
          prior to the next billing date. No refunds for digital products (per our Terms).
        </p>
      </div>
    </div>
  );
}
