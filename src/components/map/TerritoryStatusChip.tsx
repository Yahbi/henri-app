"use client";

import { useEffect, useState } from "react";
import { MapPin, Lock, ArrowUpRight } from "lucide-react";

/**
 * TerritoryStatusChip — surfaces the contractor's territory + plan posture
 * on the full-screen map filter bar.
 *
 * Module 21 of the enhancement plan (2026-05-09). Reinforces the founder
 * premise: territory exclusivity is the wedge. The chip makes the
 * contractor's slot count + plan tier + trade-gating state legible at a
 * glance.
 *
 * Renders 3 lines of microcopy:
 *   1. "{plan_label} · {claimed}/{cap} ZIPs"      — primary identity
 *   2. "Showing {trade} leads only" / "All trades" — gating state
 *   3. Upgrade CTA when not on enterprise
 */

interface TerritoryStatus {
  plan: string;
  plan_label: string;
  monthly_price: number;
  zip_cap: number;
  zips_claimed: number;
  zips_remaining: number;
  sees_all_trades: boolean;
  gated_trade: string | null;
  profile_trade: string | null;
  next_tier: {
    tier: string;
    label: string;
    monthly_price_dollars: number;
    zip_cap: number;
  } | null;
  upgrade_unlocks_trades: boolean;
  upgrade_adds_zips: number;
}

function formatTrade(t: string | null): string {
  if (!t) return "your trade";
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TerritoryStatusChip() {
  const [data, setData] = useState<TerritoryStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/territories/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: TerritoryStatus) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  if (error || !data) return null;

  const { plan_label, zip_cap, zips_claimed, zips_remaining, sees_all_trades,
          gated_trade, next_tier, upgrade_adds_zips, upgrade_unlocks_trades } = data;
  const atCap = zip_cap > 0 && zips_remaining === 0;
  const noTerritories = zips_claimed === 0 && zip_cap > 0;

  // Compose the upgrade prompt — describe the primary unlock.
  let upgradeBenefit = "";
  if (next_tier) {
    const parts: string[] = [];
    if (upgrade_adds_zips > 0) parts.push(`+${upgrade_adds_zips} more ZIPs`);
    if (upgrade_unlocks_trades) parts.push("all trades");
    upgradeBenefit = parts.length ? parts.join(" · ") : "more capacity";
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/8 text-[11px]"
      title={
        sees_all_trades
          ? `${plan_label} plan · ${zips_claimed} of ${zip_cap} ZIPs claimed · sees all trades`
          : `${plan_label} plan · ${zips_claimed} of ${zip_cap} ZIPs claimed · ${formatTrade(gated_trade ?? data.profile_trade)} leads only`
      }
    >
      <MapPin className="h-3 w-3 text-[#7d4f39] shrink-0" />
      <span className="text-[#7d4f39] font-medium whitespace-nowrap">
        {plan_label}
      </span>
      <span className="text-[#7d4f39]/70 whitespace-nowrap">·</span>
      <span className="text-[#7d4f39] whitespace-nowrap">
        <span className={atCap || noTerritories ? "font-semibold" : ""}>
          {zips_claimed}
        </span>
        <span className="opacity-60">/{zip_cap}</span>
        <span className="opacity-70 ml-1">ZIPs</span>
      </span>

      {!sees_all_trades && gated_trade && (
        <>
          <span className="text-[#7d4f39]/70 whitespace-nowrap">·</span>
          <span className="text-[#7d4f39] whitespace-nowrap inline-flex items-center gap-1">
            <Lock className="h-2.5 w-2.5" />
            {formatTrade(gated_trade)} only
          </span>
        </>
      )}

      {next_tier && (atCap || !sees_all_trades) && (
        <>
          <span className="text-[#7d4f39]/70 whitespace-nowrap">·</span>
          <a
            href="/settings/billing"
            className="text-[#7d4f39] font-medium underline-offset-2 hover:underline whitespace-nowrap inline-flex items-center gap-0.5"
          >
            Upgrade to {next_tier.label}
            {upgradeBenefit ? (
              <span className="opacity-70 ml-1">({upgradeBenefit})</span>
            ) : null}
            <ArrowUpRight className="h-2.5 w-2.5 ml-0.5" />
          </a>
        </>
      )}
    </div>
  );
}
