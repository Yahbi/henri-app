/* ── Shared plan constants (single source of truth) ────────────────────────── */

export const PLAN_ZIP_LIMITS: Record<string, number> = {
  /* `free` is the profiles.plan DEFAULT and what the Stripe webhook writes
   * on cancellation / non-payment. It was absent here, so every lookup of
   * the form `PLAN_ZIP_LIMITS[plan] ?? <n>` resolved a free account to
   * whatever that fallback was — 5 ZIPs at the app layer in
   * /api/territories, i.e. Starter's allowance for $0. Only the DB cap
   * stopped it. Listed explicitly so a free account is 0 everywhere. */
  free: 0,
  founder: 3,
  starter: 5,
  pro: 12,
  enterprise: 20,
};

export const PLAN_INFO: Record<string, { label: string; price: string }> = {
  founder: { label: "Founder", price: "$149/mo" },
  starter: { label: "Starter", price: "$749/mo" },
  pro: { label: "Pro", price: "$1,499/mo" },
  enterprise: { label: "Enterprise", price: "$2,555/mo" },
};
