/* ── Shared plan constants (single source of truth) ────────────────────────── */

export const PLAN_ZIP_LIMITS: Record<string, number> = {
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
