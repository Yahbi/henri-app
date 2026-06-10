/**
 * Territory-scoped enrichment priority (WS2).
 *
 * Resolves the drain-priority ZIP sets and per-lead tier so the enrich
 * crons process CLAIMED territories first and only ever spend keyed/quota-
 * bound sources where the business model says they should:
 *   tier 1 — paid claimed ZIPs   (full source stack)
 *   tier 2 — trial claimed ZIPs  (free in-DB sources only)
 *   tier 3 — operator target ZIPs (free + high-volume-free APIs)
 *   tier 4 — everything else     (free in-DB sources only)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrichTier } from "./quota";

export interface PriorityZipSets {
  paid: Set<string>;
  trial: Set<string>;
  target: Set<string>;
}

/** Load the claimed-territory + target-metro ZIP sets. Cheap: territories
 *  and target metros are both small tables. A contractor counts as PAID
 *  once they have a Stripe subscription and their trial has ended (or
 *  there was no trial); on TRIAL while trial_ends_at is in the future. */
export async function getPriorityZipSets(
  supabase: SupabaseClient,
): Promise<PriorityZipSets> {
  const paid = new Set<string>();
  const trial = new Set<string>();
  const target = new Set<string>();

  const { data: terrs } = await supabase
    .from("territories")
    .select("zip, profiles!inner(stripe_subscription_id, trial_ends_at)")
    .eq("status", "active");

  const nowMs = Date.now();
  for (const row of (terrs ?? []) as Array<{
    zip: string;
    profiles:
      | { stripe_subscription_id: string | null; trial_ends_at: string | null }
      | Array<{ stripe_subscription_id: string | null; trial_ends_at: string | null }>;
  }>) {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!p) continue;
    const hasSub = !!p.stripe_subscription_id;
    const trialActive =
      !!p.trial_ends_at && new Date(p.trial_ends_at).getTime() > nowMs;
    if (hasSub && !trialActive) paid.add(row.zip);
    else if (trialActive) trial.add(row.zip);
    // A claimed ZIP with neither a sub nor an active trial gets no keyed
    // spend (falls through to tier 4) — correct under the no-pay-no-quota rule.
  }

  const { data: targets } = await supabase
    .from("enrichment_target_metros")
    .select("zip")
    .eq("enabled", true);
  for (const t of (targets ?? []) as Array<{ zip: string }>) target.add(t.zip);

  return { paid, trial, target };
}

/** Tier for a lead's ZIP. Paid wins over trial wins over target. */
export function leadTier(
  zip: string | null | undefined,
  sets: PriorityZipSets,
): EnrichTier {
  if (!zip) return 4;
  if (sets.paid.has(zip)) return 1;
  if (sets.trial.has(zip)) return 2;
  if (sets.target.has(zip)) return 3;
  return 4;
}

/** All priority ZIPs (paid + trial + target) — used to pull priority leads
 *  to the front of an enrich batch. */
export function allPriorityZips(sets: PriorityZipSets): string[] {
  return [...new Set([...sets.paid, ...sets.trial, ...sets.target])];
}
