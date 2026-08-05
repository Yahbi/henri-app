"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Award } from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { Skeleton } from "@/components/ui/skeleton";

/* ─── Tier System ─── */
type TierName = "Bronze" | "Silver" | "Gold" | "Platinum";

interface TierConfig {
  name: TierName;
  color: string;
  bgColor: string;
  minScore: number;
}

const tiers: TierConfig[] = [
  { name: "Platinum", color: "text-purple-400", bgColor: "bg-purple-500/10", minScore: 90 },
  { name: "Gold", color: "text-[#D4A24A]", bgColor: "bg-[rgba(212,162,74,0.1)]", minScore: 75 },
  { name: "Silver", color: "text-zinc-400", bgColor: "bg-zinc-500/10", minScore: 50 },
  { name: "Bronze", color: "text-orange-400", bgColor: "bg-orange-500/10", minScore: 0 },
];

/* ─── Peer averages ───
 * Null until we have a real /api/analytics/peer-averages endpoint that
 * aggregates across all contractors in the same trade + ZIP cohort.
 * Prior code shipped with `{ responseTimeH: 4.2, closeRate: 22, reviewScore: 4.5 }`
 * — literal values that rendered as "peer average" labels on every
 * dashboard even though we'd never computed them. Consumers should
 * hide the comparison column when null. */
const peerAvg: { responseTimeH: number; closeRate: number; reviewScore: number } | null = null;

/* ─── Metric comparison ─── */
function MetricRow({ label, yours, peer, unit, lowerIsBetter = false }: {
  label: string;
  yours: number;
  peer: number;
  unit: string;
  lowerIsBetter?: boolean;
}) {
  const diff = yours - peer;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const neutral = Math.abs(diff) < 0.5;

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {yours.toFixed(unit === "h" ? 1 : 0)}{unit}
        </span>
        {neutral ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Minus className="h-3 w-3" /> Same
          </span>
        ) : better ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400">
            <TrendingUp className="h-3 w-3" /> Above avg
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-red-400">
            <TrendingDown className="h-3 w-3" /> Below avg
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Component ─── */
export function BenchmarkWidget() {
  const { data: leadsRaw, isLoading, isError, refetch } = useLeads();
  const leads = useMemo(() => leadsRaw ?? [], [leadsRaw]);

  // Mount-time reference so the 30-day window is stable across renders
  const [mountNow] = useState(() => Date.now());

  const myStats = useMemo(() => {
    if (!leads.length) return null;

    const thirtyDaysAgo = mountNow - 30 * 24 * 60 * 60 * 1000;
    const recent = leads.filter((l) => new Date(l.created_at).getTime() >= thirtyDaysAgo);

    const total = recent.length;
    const contacted = recent.filter((l) => ["contacted", "quoted", "proposal", "won"].includes(l.status)).length;
    const won = recent.filter((l) => l.status === "won").length;
    const closeRate = contacted > 0 ? (won / contacted) * 100 : 0;

    const responseTimes = recent
      .filter((l) => l.contacted_at)
      .map((l) => (new Date(l.contacted_at!).getTime() - new Date(l.created_at).getTime()) / 3_600_000);
    const avgResponseH = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    // Composite score for tier placement (0-100)
    const responseScore = avgResponseH !== null ? Math.max(0, 100 - avgResponseH * 10) : 50;
    const closeScore = Math.min(closeRate * 2, 100);
    const volumeScore = Math.min(total * 5, 100);
    const compositeScore = Math.round((responseScore + closeScore + volumeScore) / 3);

    return { closeRate, avgResponseH, compositeScore, total };
  }, [leads, mountNow]);

  const currentTier = tiers.find((t) => (myStats?.compositeScore ?? 0) >= t.minScore) ?? tiers[tiers.length - 1];
  const nextTier = tiers[tiers.indexOf(currentTier) - 1];

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">How You Compare</h3>
        {/* Only claim a tier once it's computed from real leads — the
            `?? 0` fallback otherwise asserted Bronze on an empty or
            failed fetch. */}
        {myStats && (
          <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${currentTier.bgColor} ${currentTier.color}`}>
            <Award className="h-3 w-3" aria-hidden="true" />
            {currentTier.name}
          </div>
        )}
      </div>

      {isLoading ? (
        /* Skeleton rows while the leads fetch is in flight — previously
         * this fell into the "Processing..." copy, which read as a stuck
         * compute step rather than a loading state. */
        <div className="space-y-2 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ) : myStats ? (
        <>
          <div className="divide-y divide-border">
            {/* Peer column is only rendered when we have a real peer-
             * average dataset (currently always null — endpoint TBD). */}
            {peerAvg ? (
              <>
                <MetricRow
                  label="Response Time"
                  yours={myStats.avgResponseH ?? 0}
                  peer={peerAvg.responseTimeH}
                  unit="h"
                  lowerIsBetter
                />
                <MetricRow
                  label="Close Rate"
                  yours={myStats.closeRate}
                  peer={peerAvg.closeRate}
                  unit="%"
                />
              </>
            ) : (
              <div className="py-4 text-xs text-muted-foreground">
                <p>
                  <span className="uppercase tracking-wider text-[9px] text-muted-foreground/60 mr-1.5">
                    Your stats
                  </span>
                  Response {myStats.avgResponseH != null ? `${Math.round(myStats.avgResponseH)}h` : "—"}
                  {" · "}Close rate {myStats.closeRate.toFixed(0)}%
                </p>
                <p className="mt-1 text-[10px] opacity-70">
                  Peer comparison activates once we have enough contractors
                  in your trade + ZIP cohort to publish an anonymized benchmark.
                </p>
              </div>
            )}
          </div>

          {/* Next tier progress */}
          {nextTier && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Next: {nextTier.name}</span>
                <span className="text-foreground">{myStats.compositeScore}/{nextTier.minScore}</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min((myStats.compositeScore / nextTier.minScore) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </>
      ) : isError ? (
        /* A failed fetch used to render the same "Processing..." copy as
         * an empty account — indistinguishable, and it never resolved. */
        <div role="alert" className="py-4 text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            Couldn&apos;t load your performance data.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="py-4 text-center">
          <p className="text-xs text-muted-foreground">
            No leads in the last 30 days yet — this fills in as leads land.
          </p>
        </div>
      )}
    </div>
  );
}
