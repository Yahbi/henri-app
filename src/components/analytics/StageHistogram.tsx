"use client";

/**
 * StageHistogram — opportunity-stage breakdown chart for the Analytics tab.
 *
 * Module 24 of the enhancement plan (2026-05-09). Counts the contractor's
 * leads by `opportunity_stage` and renders a horizontal bar chart with
 * the canonical stage palette so the analytics view ties back visually
 * to the LeadCard / drawer chip / map pin / kanban card.
 *
 * Pure presentational component — receives the lead list as a prop and
 * does the aggregation + sort in-memory. Skips entries with null stage.
 */

import { useMemo } from "react";
import { paletteFor, STAGE_PALETTE } from "@/lib/intent/stage-colors";
import type { Lead } from "@/types/lead";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StageHistogramProps {
  leads: Lead[] | null | undefined;
  isLoading?: boolean;
}

export function StageHistogram({ leads, isLoading }: StageHistogramProps) {
  // Aggregate counts in render order (display sorted by count DESC).
  const buckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of leads ?? []) {
      const stage = l.opportunity_stage;
      if (!stage) continue;
      map.set(stage, (map.get(stage) ?? 0) + 1);
    }
    const entries = Array.from(map.entries())
      .map(([stage, n]) => ({ stage, n, palette: paletteFor(stage) }))
      .filter((b) => b.palette !== null)
      .sort((a, b) => b.n - a.n);
    return entries;
  }, [leads]);

  const total = buckets.reduce((acc, b) => acc + b.n, 0);
  const max = buckets[0]?.n ?? 0;
  const unclassified = (leads ?? []).length - total;

  if (isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="space-y-2.5">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (buckets.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          Opportunity stage breakdown
        </h3>
        <p className="text-xs text-muted-foreground">
          No leads have been classified yet. As the intent backfill runs
          and the score cron stamps new leads, this chart fills in.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">
          Opportunity stage breakdown
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {total.toLocaleString()} classified
          {unclassified > 0 && (
            <span className="opacity-70">
              {" "}· {unclassified.toLocaleString()} pending
            </span>
          )}
        </span>
      </div>

      <div className="space-y-2">
        {buckets.map(({ stage, n, palette }) => {
          if (!palette) return null;
          const pct = max > 0 ? (n / max) * 100 : 0;
          const sharePct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={stage} className="flex items-center gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 w-44 shrink-0">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: palette.color }}
                />
                <span className="text-foreground truncate">
                  {palette.label}
                </span>
              </div>
              <div className="flex-1 h-5 bg-bg-subtle rounded-md overflow-hidden relative">
                <div
                  className="h-full rounded-md transition-all"
                  style={{
                    width: `${pct}%`,
                    background: palette.color,
                    opacity: 0.7,
                  }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-foreground/85">
                  {n.toLocaleString()}
                </span>
              </div>
              <span className="w-10 text-right text-muted-foreground tabular-nums">
                {sharePct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend pill — hot pool callout. The "permit_filed_no_contractor"
          bucket is the wedge's hottest pool: homeowner is hiring + no
          contractor named yet. Highlight it inline so the analytics view
          reinforces the same product story as the drawer + map. */}
      {(() => {
        const hot = buckets.find((b) => b.stage === "permit_filed_no_contractor");
        if (!hot || !hot.palette) return null;
        return (
          <div className="mt-3 pt-3 border-t border-border/40 text-[11px] flex items-center gap-2">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: hot.palette.color }}
            />
            <span className="text-muted-foreground">
              Hot pool: <span className="font-semibold text-foreground">{hot.n.toLocaleString()}</span> leads where the homeowner is still hiring (permit filed, no contractor named).
            </span>
          </div>
        );
      })()}

      {/* Stable-key suppress: STAGE_PALETTE export ensures the palette
          file is the canonical source — referenced here as a no-op so
          tree-shaking keeps it available for downstream surfaces. */}
      <span className="hidden">{Object.keys(STAGE_PALETTE).length}</span>
    </Card>
  );
}
