"use client";

import { cn } from "@/lib/utils/cn";
import {
  isScoreSignalBreakdown,
  SCORE_SIGNAL_ORDER,
  type ScoreSignalContribution,
} from "@/lib/scoring/signals";
import type { LeadData } from "./LeadCard";

/**
 * Phase 0a — transparent score breakdown.
 *
 * Renders the six scoring signals with their contribution bar, value,
 * and a one-line "why" detail. Reads structured data from
 * `lead.scoreSignals` (jsonb written by the scorer). Falls back to
 * synthesizing a 4-signal breakdown from the legacy numeric columns
 * (`score_freshness` / `score_value` / `score_contact` / `score_demand`)
 * when a lead was scored before migration 00031 ran.
 *
 * Design philosophy (from the plan, wedge #2):
 *   "Never hide why a lead scored 65 vs 85. Show the signals with
 *    their sub-scores. Contractors who understand the score trust
 *    the score."
 */
export function ScoreSignalBreakdown({ lead }: { lead: LeadData }) {
  const rows = deriveRows(lead);
  if (rows.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.value, 0);
  const maxTotal = rows.reduce((n, r) => n + r.weight, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Why this score
        </span>
        <span className="text-[10px] text-muted-foreground">
          {total} / {maxTotal} signals
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <SignalRow key={r.signal} row={r} />
        ))}
      </div>
    </div>
  );
}

function SignalRow({ row }: { row: ScoreSignalContribution }) {
  const pct = row.weight > 0 ? Math.min(100, (row.value / row.weight) * 100) : 0;
  // Color tiers mirror the urgency palette from globals.css — keeps
  // the drawer consistent with the lead card's urgency dot.
  const barTone =
    pct >= 75 ? "bg-hot" : pct >= 50 ? "bg-warm" : pct > 0 ? "bg-cool" : "bg-border";
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-[110px] shrink-0 text-muted-foreground truncate" title={row.label}>
        {row.label}
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barTone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-[56px] text-right tabular-nums text-foreground font-medium">
        {row.value}
        <span className="text-muted-foreground font-normal">/{row.weight}</span>
      </div>
      <div className="flex-1 min-w-0 text-[10.5px] text-muted-foreground truncate" title={row.detail}>
        {row.detail}
      </div>
    </div>
  );
}

/**
 * Resolve structured breakdown first; fall back to legacy numeric
 * columns when the lead hasn't been re-scored since migration 00031.
 */
function deriveRows(lead: LeadData): ScoreSignalContribution[] {
  if (isScoreSignalBreakdown(lead.scoreSignals)) {
    return lead.scoreSignals;
  }

  // Legacy fallback. Map the four (or six when available) numeric
  // columns onto the canonical SCORE_SIGNAL_ORDER so the UI still
  // renders something meaningful on un-migrated rows.
  const bucketValue: Record<string, number | undefined> = {
    permit_freshness: lead.freshScore,
    permit_value: lead.valueScore,
    contact_completeness: lead.contactScore,
    zip_demand: lead.demandScore,
    homeowner_engagement: lead.engagementScore,
    historical_conversion: lead.conversionScore,
  };

  const rows: ScoreSignalContribution[] = [];
  for (const { key, label, weight } of SCORE_SIGNAL_ORDER) {
    const raw = bucketValue[key];
    if (typeof raw !== "number") continue;
    rows.push({
      signal: key,
      label,
      weight,
      value: Math.round(Math.max(0, Math.min(weight, raw))),
      detail: "(legacy score \u2014 re-score for full breakdown)",
    });
  }
  return rows;
}
