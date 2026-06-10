/**
 * Territory-scoped enrichment policy: source classes, per-tier allowances,
 * and per-source quota budgets.
 *
 * Architecture (2026-06-10): enrichment is fulfillment, not preparation.
 * Paid/quota-bound sources follow CLAIMED territories and score rank; the
 * corpus at large only ever gets FREE in-DB enrichment. This module is the
 * pure policy layer — no I/O except the quota load/record helpers that the
 * cron calls once per run.
 *
 * There is NO user-facing reveal/credit/metering. Cost containment is
 * territory scoping, full stop.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Drain priority. Computed per-lead by the enrich cron from claimed
 *  territories + the target-metro config. */
export type EnrichTier = 1 | 2 | 3 | 4;
//  1 = claimed PAID territory   → full stack (free + high-vol-free + keyed)
//  2 = claimed TRIAL territory  → FREE in-DB sources only (no keyed spend)
//  3 = operator target metro    → free + high-volume-free APIs (no low-quota keyed)
//  4 = everything else          → FREE in-DB sources only, idle-capacity fill

/** How a source is funded. Drives the per-tier allowance + quota gating. */
export type SourceClass =
  | "free" // in-DB or unlimited free public endpoint — always allowed
  | "highVolumeFree" // generous free quota (OpenCorporates 500/day, FEC 1k/hr, Google credit)
  | "keyed" // metered key, moderate budget
  | "lowQuotaKeyed"; // scarce budget (Numverify 100/mo, Hunter 25/mo, Apollo paid)

interface SourceSpec {
  class: SourceClass;
  /** Budget per period. null = unlimited (free class). */
  budget: number | null;
  /** 'month' → period key YYYY-MM; 'day' → YYYY-MM-DD. */
  window: "month" | "day" | null;
}

/** Source registry. Keys MUST match the telemetry source names used in
 *  orchestrator.ts `trace(...)` calls so the cron can record spend from
 *  telemetry. Free sources are listed for completeness/clarity. */
export const SOURCE_SPECS: Record<string, SourceSpec> = {
  // ── free (always allowed, no budget) ──
  permit_description: { class: "free", budget: null, window: null },
  same_address_permit: { class: "free", budget: null, window: null },
  voter_file_local: { class: "free", budget: null, window: null },
  ppp_sba: { class: "free", budget: null, window: null },
  county_gis: { class: "free", budget: null, window: null },
  osm_contact: { class: "free", budget: null, window: null },
  contractor_license: { class: "free", budget: null, window: null },
  // ── high-volume free (generous quota) ──
  opencorporates: { class: "highVolumeFree", budget: 500, window: "day" },
  fec: { class: "highVolumeFree", budget: 1000, window: "day" },
  google_places: { class: "highVolumeFree", budget: 5000, window: "month" },
  // ── keyed (moderate budget) ──
  cloudmersive_phone: { class: "keyed", budget: 800, window: "month" },
  cloudmersive_address: { class: "keyed", budget: 800, window: "month" },
  weatherstack: { class: "keyed", budget: 100, window: "month" },
  yelp: { class: "keyed", budget: 5000, window: "month" },
  regrid: { class: "keyed", budget: 1000, window: "month" },
  // ── low-quota keyed (priority-1 ONLY) ──
  // Keys match the telemetry source names emitted by orchestrator trace().
  numverify: { class: "lowQuotaKeyed", budget: 100, window: "month" },
  hunter_io: { class: "lowQuotaKeyed", budget: 25, window: "month" },
  apollo: { class: "lowQuotaKeyed", budget: 750, window: "month" },
};

/** Which source classes a tier is allowed to spend. Low-quota keyed
 *  sources are additionally restricted to tier 1 only (see tierAllows). */
export function tierAllows(tier: EnrichTier, cls: SourceClass): boolean {
  if (cls === "free") return true;
  switch (tier) {
    case 1: // paid — everything
      return true;
    case 2: // trial — free only
      return false;
    case 3: // target metro — free + high-volume-free
      return cls === "highVolumeFree";
    case 4: // rest — free only
      return false;
  }
}

/** Period key for a source's budget window. `now` is injected for tests. */
export function periodKey(window: "month" | "day" | null, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (window === "day") {
    const d = String(now.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}`;
}

/** Snapshot of remaining budget per source for the current period. Loaded
 *  once at the start of an enrich run; the orchestrator decrements it
 *  in-memory and the cron persists actual spend afterward. */
export type QuotaRemaining = Record<string, number>;

export async function loadQuotaRemaining(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<QuotaRemaining> {
  const remaining: QuotaRemaining = {};
  // Seed every budgeted source with its full budget.
  for (const [source, spec] of Object.entries(SOURCE_SPECS)) {
    if (spec.budget != null) remaining[source] = spec.budget;
  }
  // Subtract this period's recorded usage.
  const periods = new Set<string>();
  for (const spec of Object.values(SOURCE_SPECS)) {
    if (spec.window) periods.add(periodKey(spec.window, now));
  }
  const { data } = await supabase
    .from("enrichment_quota_usage")
    .select("source, period, used")
    .in("period", [...periods]);
  for (const row of (data ?? []) as Array<{ source: string; period: string; used: number }>) {
    const spec = SOURCE_SPECS[row.source];
    if (!spec || spec.budget == null) continue;
    if (row.period !== periodKey(spec.window, now)) continue;
    remaining[row.source] = Math.max(0, spec.budget - row.used);
  }
  return remaining;
}

/** Persist actual spend (from telemetry call-counts) after a run. Soft
 *  budgets — a small overshoot from parallel workers is acceptable. */
export async function recordSpend(
  supabase: SupabaseClient,
  spentBySource: Record<string, number>,
  now = new Date(),
): Promise<void> {
  for (const [source, count] of Object.entries(spentBySource)) {
    const spec = SOURCE_SPECS[source];
    if (!spec || spec.budget == null || count <= 0) continue;
    try {
      await supabase.rpc("record_enrichment_spend", {
        p_source: source,
        p_period: periodKey(spec.window, now),
        p_budget: spec.budget,
        p_count: count,
      });
    } catch {
      // Best-effort accounting — never break enrichment over a quota write.
    }
  }
}
