/**
 * Plan-tier ZIP caps + helpers — single source of truth for the
 * territory-exclusivity wedge.
 *
 * The premise of Henri:
 *   each contractor buys a TERRITORY (slot in ZIPs). Their plan tier
 *   determines how many ZIPs they can claim. The exclusivity is the
 *   product — it's why contractors pay.
 *
 * Pricing (locked, src/CLAUDE.md):
 *   free        →  0 ZIPs (cannot claim — must upgrade)
 *   founder     →  3 ZIPs    ($149/mo)
 *   starter     →  5 ZIPs    ($749/mo)
 *   pro         → 12 ZIPs    ($1,499/mo)
 *   enterprise  → 20 ZIPs    ($2,555/mo)
 *
 * Server-side enforcement lives in `claim_territory` RPC (migration
 * 00088). This file is the read-side helper used by API routes and
 * UI components to render plan-aware copy + upgrade CTAs.
 */

export type PlanTier = "free" | "founder" | "starter" | "pro" | "enterprise";

export interface PlanInfo {
  tier: PlanTier;
  label: string;
  monthly_price_dollars: number;
  zip_cap: number;
  /** Higher tiers `unlocks` here trump the trade-gating filter — the
   *  enterprise tier is the "GC tier" that sees all trades. */
  sees_all_trades: boolean;
}

export const PLAN_INFO: Record<PlanTier, PlanInfo> = {
  free: {
    tier: "free",
    label: "Free",
    monthly_price_dollars: 0,
    zip_cap: 0,
    sees_all_trades: false,
  },
  founder: {
    tier: "founder",
    label: "Founder",
    monthly_price_dollars: 149,
    zip_cap: 3,
    sees_all_trades: false,
  },
  starter: {
    tier: "starter",
    label: "Starter",
    monthly_price_dollars: 749,
    zip_cap: 5,
    sees_all_trades: false,
  },
  pro: {
    tier: "pro",
    label: "Pro",
    monthly_price_dollars: 1499,
    zip_cap: 12,
    sees_all_trades: false,
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    monthly_price_dollars: 2555,
    zip_cap: 20,
    sees_all_trades: true,  // the "GC tier"
  },
};

const TIER_ORDER: PlanTier[] = ["free", "founder", "starter", "pro", "enterprise"];

/** Resolve a possibly-unknown plan string. Defaults to free for safety. */
export function planInfo(plan: string | null | undefined): PlanInfo {
  const tier = (plan ?? "free") as PlanTier;
  return PLAN_INFO[tier] ?? PLAN_INFO.free;
}

/** Return the next tier up — used by the upgrade CTA. */
export function nextTier(plan: string | null | undefined): PlanInfo | null {
  const current = ((plan ?? "free") as PlanTier);
  const idx = TIER_ORDER.indexOf(current);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return PLAN_INFO[TIER_ORDER[idx + 1]];
}
