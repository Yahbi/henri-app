"use client";

import { useState } from "react";
import { Check, CreditCard, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useUser } from "@/hooks/useUser";

interface PlanTier {
  slug: string;
  name: string;
  price: string;
  priceNum: number;
  interval: string;
  description: string;
  features: string[];
  territories: number;
  highlighted?: boolean;
}

const PLANS: PlanTier[] = [
  {
    slug: "founder",
    name: "Founder",
    price: "$149",
    priceNum: 149,
    interval: "/mo",
    description: "Beta pricing. Locked forever for early supporters.",
    features: [
      "3 ZIP territories",
      "AI-scored permit leads",
      "Best-effort owner contact enrichment",
      "Email & SMS outreach (compose & send)",
      "Price locked forever",
    ],
    territories: 3,
  },
  {
    slug: "starter",
    name: "Starter",
    price: "$749",
    priceNum: 749,
    interval: "/mo",
    description: "For contractors ready to own their territory.",
    features: [
      "5 ZIP territories",
      "AI-scored permit leads",
      "Best-effort owner contact enrichment",
      "Email & SMS outreach (compose & send)",
      "Storm Center dashboard",
    ],
    territories: 5,
  },
  {
    slug: "pro",
    name: "Pro",
    price: "$1,499",
    priceNum: 1499,
    interval: "/mo",
    description: "Full platform access for serious contractors.",
    features: [
      "12 ZIP territories",
      "Everything in Starter",
      "Daily license verification (compliance)",
      "Storm Center dashboard",
      "Priority email support",
    ],
    territories: 12,
    highlighted: true,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: "$2,555",
    priceNum: 2555,
    interval: "/mo",
    description: "Maximum coverage for large operations.",
    features: [
      "20 ZIP territories",
      "Everything in Pro",
      "Dedicated account manager",
      "Custom onboarding",
      "Priority email support",
    ],
    territories: 20,
  },
];

export default function BillingPage() {
  const { profile } = useUser();
  const [managingBilling, setManagingBilling] = useState(false);
  const [upgradingTo, setUpgradingTo] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanTier | null>(null);
  // Inline banner state — replaces the prior 4× native `alert()` dialogs
  // which were jarring on a paid dashboard. tone="success" is rendered
  // green; "error" is red; "info" is primary-tinted.
  const [banner, setBanner] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  // Beta-locked fallback: Founder ($149, 3 ZIPs) per CLAUDE.md. Previously
  // fell back to Starter which hid the Founder tier from pre-checkout users.
  const currentPlanSlug = profile?.plan ?? "founder";
  const currentPlan = PLANS.find((p) => p.slug === currentPlanSlug) ?? PLANS[0];

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

    const isDowngrade = plan.priceNum < currentPlan.priceNum;
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
    const hasSubscription = !!profile?.stripe_customer_id;
    if (hasSubscription && !isSamePlan) {
      try {
        const res = await fetch("/api/billing/change-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: plan.slug }),
        });
        if (!res.ok) throw new Error();
        setBanner({
          tone: "success",
          text: `Upgraded to ${plan.name}. Your new territories are available immediately.`,
        });
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
              ? "flex items-start justify-between gap-3 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300"
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

      {/* Current plan banner */}
      <div className="bg-primary-04 border border-primary/20 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">Current Plan</p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {currentPlan.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">{currentPlan.price}/mo</span>
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {currentPlan.territories} ZIP territories · AI-scored leads · Best-effort owner contact enrichment
            </p>
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
          {PLANS.map((plan) => {
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
                    : plan.highlighted
                      ? "border-primary ring-2 ring-primary/30 shadow-lg"
                      : "border-border"
                )}
              >
                {/* Popular ribbon — only when NOT also the current plan
                 * (avoids a ribbon pile-up if the user is on Pro). */}
                {plan.highlighted && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 bg-primary text-white px-2.5 py-0.5 rounded-full text-[11px] font-semibold shadow">
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
                  {plan.features.map((f) => (
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
                      plan.highlighted
                        ? "bg-primary text-white hover:opacity-90"
                        : "border border-border hover:bg-accent"
                    )}
                  >
                    {isUpgrading ? "Redirecting..." : plan.priceNum > currentPlan.priceNum ? "Upgrade" : "Downgrade"}
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
              {confirmPlan.priceNum > currentPlan.priceNum ? "Upgrade" : "Downgrade"} to {confirmPlan.name}?
            </h3>
            <p className="text-sm text-muted-foreground">
              {confirmPlan.priceNum > currentPlan.priceNum
                ? "You will be redirected to Stripe to complete your upgrade. The new plan takes effect immediately. Your 24-hour free trial applies if this is your first subscription."
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
                className="flex-1 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
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
