/**
 * Plan tiers + feature bullets — the ONE source of truth for every surface
 * that renders the price list.
 *
 * Why this file exists (2026-08-04): the same four tiers were declared
 * independently in `src/components/landing/PricingSection.tsx` and
 * `src/app/(dashboard)/settings/billing/page.tsx`, and the two copies had
 * already drifted — Pro advertised "Compliance dashboard" on the marketing
 * page but not in Settings, so a contractor comparing the page they bought
 * from with the page they manage billing on saw two different products.
 *
 * Prices and ZIP counts are locked by CLAUDE.md and must stay in step with
 * `src/lib/territory/plan-caps.ts` (`zip_cap`), which is what the
 * `claim_territory` RPC actually enforces server-side (migrations 00088 /
 * 00113). If you change a number here, change it there in the same commit.
 *
 * ── Rule for adding a bullet ───────────────────────────────────────────
 * A bullet may only claim something the code does, at the tier it is listed
 * under. If a capability is reachable on EVERY plan it belongs in
 * SHARED_FEATURES — listing it under Starter implies Founder does not get
 * it, which is a paid-feature claim the code does not back. That is exactly
 * how "Storm Center dashboard" ended up sold as a Starter-and-above feature
 * while `/dashboard/storm` carried no plan gate at all.
 *
 * ── Claims removed from these lists, and why ──────────────────────────
 * (Kept as comments so the next version knows where the old lie lived.)
 *   "Full owner contact data" / "Full contact enrichment"  (2026-04-30)
 *       → "Best-effort owner contact enrichment". ~39% of leads carry an
 *         owner_name, ~1% a phone. "Full" was overclaiming.
 *   "Storm Center alerts" / "Storm alerts & permit surge"  (2026-04-30)
 *       → "Storm Center dashboard". Nothing pushes a storm alert; the
 *         cron only ingests. "Permit surge" had no implementation.
 *   "Priority lead routing"                                (2026-04-30)
 *       → dropped. Routing is territory scoping, identical on every plan.
 *   "Team seats (up to 10)"                                (2026-04-30)
 *       → dropped. No team / invite / multi-user code exists.
 *   "Daily license verification (compliance)"              (2026-08-04)
 *       → dropped. src/lib/license/verify.ts calls no licensing board —
 *         every path returns "pending" — and nothing gates lead delivery
 *         on license status.
 *   "Storm Center dashboard" (Starter+) and "Compliance dashboard" (Pro)
 *   as tier differentiators                                (2026-08-04)
 *       → moved to SHARED_FEATURES. Neither surface has a plan gate, so
 *         selling them as tier upgrades described a paywall that does
 *         not exist.
 */

export type PlanSlug = "founder" | "starter" | "pro" | "enterprise";

export interface PlanTier {
  slug: PlanSlug;
  name: string;
  /** Display price, pre-formatted with the thousands separator. */
  price: string;
  /** Whole dollars. Comparison only (upgrade vs downgrade) — never rendered. */
  priceNum: number;
  interval: "/mo";
  description: string;
  /** ZIP territories included. Enforced by `claim_territory` (00088 / 00113). */
  territories: number;
  /** Bullets unique to this tier. Rendered after the shared set. */
  features: string[];
  /** "Most popular" emphasis on the pricing cards. */
  popular?: boolean;
}

/**
 * Capabilities every paid tier reaches. None of these is plan-gated
 * anywhere in the app, so none may be listed as a tier differentiator.
 *
 *   Storm Center dashboard  → `/dashboard/storm` has no plan check, and the
 *                             Storm tab is in CORE_TABS for every contractor
 *                             (src/components/layout/DashboardTopBar.tsx).
 *   Compliance dashboard    → `/dashboard/compliance`, same story.
 *
 * The one plan-gated capability that does exist in code is Enterprise
 * all-trade visibility (src/lib/auth/trade-gating.ts), and it is deliberately
 * NOT claimed here: the gate is applied by `/api/leads/map` and
 * `/api/territories/status` only, not by `useLeads`, so "all trades" is not
 * true of the whole product yet. Add it to the Enterprise bullets once the
 * leads list honours the same gate.
 */
export const SHARED_FEATURES: readonly string[] = [
  "AI-scored permit leads",
  "Best-effort owner contact enrichment",
  "Email & SMS outreach (compose & send)",
  "Storm Center dashboard",
  "Compliance dashboard",
];

export const PLAN_TIERS: readonly PlanTier[] = [
  {
    slug: "founder",
    name: "Founder",
    price: "$149",
    priceNum: 149,
    interval: "/mo",
    description: "Beta pricing. Locked forever for early supporters.",
    territories: 3,
    features: ["Price locked forever"],
  },
  {
    slug: "starter",
    name: "Starter",
    price: "$749",
    priceNum: 749,
    interval: "/mo",
    description: "For contractors ready to own their territory.",
    territories: 5,
    // No tier-only bullet: what Starter buys over Founder is the larger ZIP
    // allowance and a seat that isn't capped at 100. Inventing a feature to
    // balance the card would be a fabricated differentiator.
    features: [],
  },
  {
    slug: "pro",
    name: "Pro",
    price: "$1,499",
    priceNum: 1499,
    interval: "/mo",
    description: "Full platform access for serious contractors.",
    territories: 12,
    // "Daily license verification (compliance)" lived here until 2026-08-04.
    // src/lib/license/verify.ts never calls a licensing board — every path
    // returns "pending" — and nothing gates lead delivery on license status.
    features: ["Priority email support"],
    popular: true,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: "$2,555",
    priceNum: 2555,
    interval: "/mo",
    description: "Maximum coverage for large operations.",
    territories: 20,
    features: [
      "Dedicated account manager",
      "Custom onboarding",
      "Priority email support",
    ],
  },
];

/**
 * Full bullet list for a card, in render order: ZIP allowance, then the
 * shared capabilities, then whatever is genuinely unique to the tier.
 * Every surface renders the complete list rather than "Everything in X",
 * so a reader never has to hold two cards in their head to know what
 * they're buying.
 */
export function planFeatures(tier: PlanTier): string[] {
  return [
    `${tier.territories} ZIP territories`,
    ...SHARED_FEATURES,
    ...tier.features,
  ];
}

/**
 * Resolve a `profiles.plan` value to a paid tier.
 *
 * Returns undefined for null, "free", and anything unrecognised — the three
 * states that mean "this account is not on a paid tier". Callers must treat
 * undefined as unsubscribed rather than falling back to a default tier: the
 * cancel / unpaid webhook paths write plan="free"
 * (src/app/api/webhooks/stripe/route.ts) and the profiles column DEFAULT is
 * "free", so a defaulted lookup tells a non-paying user they hold a plan.
 */
export function findPlanTier(
  plan: string | null | undefined,
): PlanTier | undefined {
  if (!plan) return undefined;
  return PLAN_TIERS.find((t) => t.slug === plan);
}

/** Cheapest / dearest tier, for the "from $X to $Y" summary lines. */
export const PLAN_PRICE_RANGE = {
  min: PLAN_TIERS.reduce((lo, t) => (t.priceNum < lo.priceNum ? t : lo)),
  max: PLAN_TIERS.reduce((hi, t) => (t.priceNum > hi.priceNum ? t : hi)),
};
