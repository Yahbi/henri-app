"use client";

import { useState, useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";
import { formatCurrency, getUrgency } from "@/types/lead";
import type { Lead } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketIntelPanel } from "@/components/dashboard/MarketIntelPanel";

const FILTERS = ["All", "New Today", "High Value", "Cascade"];

/* ── Helpers ── */

function scoreBadge(score: number) {
  const color =
    score >= 75
      ? "text-[#D4886A] bg-[rgba(212,136,106,0.12)]"
      : score >= 50
      ? "text-[#D4A24A] bg-[rgba(212,162,74,0.12)]"
      : "text-[#4A7FC0] bg-[rgba(74,127,192,0.12)]";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

function daysAgo(dateStr: string | null | undefined, fallback: string): number {
  const d = dateStr ? new Date(dateStr) : new Date(fallback);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function daysAgoLabel(days: number): string {
  if (days === 0) return "Filed today";
  if (days === 1) return "Filed 1 day ago";
  return `Filed ${days} days ago`;
}

function daysAgoColorClass(days: number): string {
  if (days <= 1) return "text-[#D4886A]";       // hot - terracotta
  if (days <= 3) return "text-[#D4A24A]";       // warm - amber
  if (days <= 7) return "text-[#7BA4C7]";       // cool - light blue
  return "text-muted-foreground";                // cold - muted
}

/** Normalize trade strings for grouping */
function normalizeTrade(lead: Lead): string {
  const raw = lead.trade ?? lead.permit_type ?? "Other";
  const lower = raw.toLowerCase().trim();
  if (lower.includes("roof")) return "Roofing";
  if (lower.includes("hvac") || lower.includes("heating") || lower.includes("cooling") || lower.includes("mechanical")) return "HVAC";
  if (lower.includes("electric")) return "Electrical";
  if (lower.includes("plumb")) return "Plumbing";
  if (lower.includes("solar") || lower.includes("pv")) return "Solar";
  if (lower.includes("paint")) return "Painting";
  if (lower.includes("general") || lower.includes("remodel") || lower.includes("alteration") || lower.includes("renovation")) return "General / Remodel";
  if (lower.includes("window") || lower.includes("door")) return "Windows / Doors";
  if (lower.includes("foundation") || lower.includes("structural")) return "Structural";
  if (lower.includes("demolition") || lower.includes("demo")) return "Demolition";
  if (lower.includes("fire") || lower.includes("sprinkler") || lower.includes("alarm")) return "Fire Protection";
  if (lower.includes("insulation") || lower.includes("energy")) return "Insulation / Energy";
  if (lower === "other" || !lower) return "Other";
  // Capitalize first letter of raw as fallback
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/* ── Skeleton loaders ── */

function IntelCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-5 w-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="flex justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

function SummaryBarSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

function TradeBreakdownSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <Skeleton className="h-5 w-36" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 flex-1 rounded-full" />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendingAreasSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <Skeleton className="h-5 w-32" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Computed analytics ── */

interface MarketSummary {
  totalPermits: number;
  avgValue: number;
  hottestTrade: string;
  filedToday: number;
  filedThisWeek: number;
}

interface TradeCount {
  trade: string;
  count: number;
}

interface ZipCount {
  zip: string;
  city: string;
  state: string;
  count: number;
}

function computeMarketSummary(leads: Lead[]): MarketSummary {
  const total = leads.length;
  const values = leads.map((l) => l.permit_value ?? l.pipeline_value ?? 0).filter((v) => v > 0);
  const avg = values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;

  // Trade frequency
  const tradeCounts: Record<string, number> = {};
  leads.forEach((l) => {
    const t = normalizeTrade(l);
    tradeCounts[t] = (tradeCounts[t] || 0) + 1;
  });
  const hottestTrade = Object.entries(tradeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

  // Time-based counts
  const now = Date.now();
  const dayMs = 86_400_000;
  let filedToday = 0;
  let filedThisWeek = 0;
  leads.forEach((l) => {
    const filed = l.permit_filed_date ? new Date(l.permit_filed_date).getTime() : new Date(l.created_at).getTime();
    const age = now - filed;
    if (age < dayMs) filedToday++;
    if (age < 7 * dayMs) filedThisWeek++;
  });

  return { totalPermits: total, avgValue: avg, hottestTrade, filedToday, filedThisWeek };
}

function computeTradeBreakdown(leads: Lead[]): TradeCount[] {
  const map: Record<string, number> = {};
  leads.forEach((l) => {
    const t = normalizeTrade(l);
    map[t] = (map[t] || 0) + 1;
  });
  return Object.entries(map)
    .map(([trade, count]) => ({ trade, count }))
    .sort((a, b) => b.count - a.count);
}

function computeTrendingZips(leads: Lead[]): ZipCount[] {
  const map: Record<string, { city: string; state: string; count: number }> = {};
  leads.forEach((l) => {
    const zip = l.zip;
    if (!zip) return;
    if (!map[zip]) {
      map[zip] = { city: l.city ?? "", state: l.state ?? "", count: 0 };
    }
    map[zip].count++;
  });
  return Object.entries(map)
    .map(([zip, data]) => ({ zip, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

/* ── Page ── */

export default function IntelPage() {
  const [activeFilter, setActiveFilter] = useState("All");
  // Previously forced min_score: 60 so low-score enriched leads never
  // appeared here. Let the tab chips drive filtering instead.
  // Destructure `error` so we can surface statement-timeout failures to
  // the user instead of silently rendering an empty Intel page. Dashboard
  // + pipeline already do this; intel was the outlier (Phase 2.8).
  const { data: leads, isLoading, error: leadsError } = useLeads();

  /* Market summary */
  const summary = useMemo<MarketSummary | null>(() => {
    if (!leads || leads.length === 0) return null;
    return computeMarketSummary(leads);
  }, [leads]);

  /* Trade breakdown */
  const tradeBreakdown = useMemo<TradeCount[]>(() => {
    if (!leads) return [];
    return computeTradeBreakdown(leads);
  }, [leads]);

  /* Trending ZIP codes */
  const trendingZips = useMemo<ZipCount[]>(() => {
    if (!leads) return [];
    return computeTrendingZips(leads);
  }, [leads]);

  /* Intel cards (enhanced from original) */
  const intelCards = useMemo(() => {
    if (!leads) return [];
    return leads.map((lead) => {
      const now = Date.now();
      const filed = lead.permit_filed_date ? new Date(lead.permit_filed_date) : new Date(lead.created_at);
      const isToday = (now - filed.getTime()) < 24 * 3600 * 1000;
      const isHighValue = (lead.permit_value ?? 0) >= 50_000 || (lead.pipeline_value ?? 0) >= 50_000;
      const isCascade = lead.cascade_flag;

      let tag = "Other";
      if (isToday) tag = "New Today";
      else if (isHighValue) tag = "High Value";
      else if (isCascade) tag = "Cascade";

      const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
      const estimatedValue = formatCurrency(lead.permit_value ?? lead.pipeline_value ?? 0);

      const days = daysAgo(lead.permit_filed_date, lead.created_at);

      let insight = lead.score_reasoning ?? "AI-scored permit opportunity in your territory.";
      if (isCascade && lead.cascade_count > 1) {
        insight = `Cascade signal: ${lead.cascade_count} related permits filed nearby -- block opportunity.`;
      }

      // Location tag
      const locationParts = [lead.city, lead.state].filter(Boolean);
      const locationTag = locationParts.length > 0 ? locationParts.join(", ") : null;

      // Build a one-line property summary from the enrichment columns.
      // Empty when none of the three is populated.
      const propertyParts: string[] = [];
      if (lead.year_built) propertyParts.push(`Built ${lead.year_built}`);
      if (lead.home_sqft) propertyParts.push(`${Number(lead.home_sqft).toLocaleString()} sqft`);
      if (lead.assessed_value) propertyParts.push(formatCurrency(lead.assessed_value));
      const propertyLine = propertyParts.length > 0 ? propertyParts.join(" · ") : null;

      return {
        id: lead.id,
        address,
        permitType: lead.permit_type ?? lead.trade ?? "Permit",
        permitNumber: lead.permit_id,
        estimatedValue,
        insight,
        score: lead.score,
        tag,
        days,
        locationTag,
        propertyLine,
        urgency: getUrgency(lead.score),
      };
    });
  }, [leads]);

  const filtered = useMemo(() => {
    if (activeFilter === "All") return intelCards;
    return intelCards.filter((c) => c.tag === activeFilter);
  }, [intelCards, activeFilter]);

  const maxTradeCount = tradeBreakdown.length > 0 ? tradeBreakdown[0].count : 1;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Intel Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time permit activity in your territory
        </p>
      </div>

      {/* Error banner — surfaces Supabase statement-timeout + auth
          failures from useLeads instead of silently rendering empty. */}
      {leadsError && (
        <div
          className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-400"
          role="alert"
        >
          Some lead data couldn&apos;t load — refresh to retry.
        </div>
      )}

      {/* Phase 0b wedge #9 — market intel per ZIP. Pre-seeded with the
          most-common ZIP in the contractor's current lead list so the
          panel shows something meaningful on first render. */}
      <MarketIntelPanel initialZip={trendingZips[0]?.zip ?? null} />

      {/* ── 1. Market Summary Bar ── */}
      {isLoading ? (
        <SummaryBarSkeleton />
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Permits</p>
            <p className="text-xl font-heading font-normal text-foreground mt-1">{summary.totalPermits}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Avg Permit Value</p>
            <p className="text-xl font-heading font-normal text-foreground mt-1">{formatCurrency(summary.avgValue)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Hottest Trade</p>
            <p className="text-xl font-heading font-normal text-[#D4886A] mt-1">{summary.hottestTrade}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Filed Today / This Week</p>
            <p className="text-xl font-heading font-normal text-foreground mt-1">
              {summary.filedToday} <span className="text-sm text-muted-foreground">/</span> {summary.filedThisWeek}
            </p>
          </div>
        </div>
      ) : null}

      {/* ── 2. Trade Breakdown & Trending Areas (side by side on desktop) ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TradeBreakdownSkeleton />
          <TrendingAreasSkeleton />
        </div>
      ) : (tradeBreakdown.length > 0 || trendingZips.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Trade Breakdown */}
          {tradeBreakdown.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-heading font-normal text-foreground mb-4">Trade Breakdown</h2>
              <div className="space-y-2.5">
                {tradeBreakdown.map(({ trade, count }) => {
                  const pct = Math.round((count / maxTradeCount) * 100);
                  return (
                    <div key={trade} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-28 shrink-0 truncate" title={trade}>
                        {trade}
                      </span>
                      <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#D4886A] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-foreground w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trending Areas */}
          {trendingZips.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-heading font-normal text-foreground mb-4">Trending Areas</h2>
              <div className="space-y-3">
                {trendingZips.map(({ zip, city, state, count }, idx) => {
                  const label = [city, state].filter(Boolean).join(", ");
                  return (
                    <div key={zip} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                            idx === 0
                              ? "bg-[rgba(212,136,106,0.15)] text-[#D4886A]"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{zip}</p>
                          {label && (
                            <p className="text-xs text-muted-foreground">{label}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-medium text-foreground">
                        {count} {count === 1 ? "permit" : "permits"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Filter Bar */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeFilter === f
                ? "bg-primary text-white"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ── 3. Enhanced Intel Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <IntelCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-semibold text-foreground">No intel available</p>
          <p className="text-xs text-muted-foreground mt-1">
            {leads?.length === 0
              ? "Your territories are being monitored -- leads will appear here as permits are filed."
              : `No leads match the "${activeFilter}" filter.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((card) => (
            <div key={card.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
              {/* Top row: address + score */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{card.address}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">{card.permitType}</span>
                    {card.permitNumber && (
                      <>
                        <span className="text-xs text-muted-foreground">--</span>
                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          #{card.permitNumber}
                        </span>
                      </>
                    )}
                    {card.locationTag && (
                      <>
                        <span className="text-xs text-muted-foreground">--</span>
                        <span className="inline-flex items-center rounded-full bg-[rgba(212,136,106,0.08)] px-2 py-0.5 text-[10px] text-[#D4886A]">
                          {card.locationTag}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {scoreBadge(card.score)}
              </div>

              {/* AI Insight */}
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground leading-relaxed">{card.insight}</p>
              </div>

              {/* Property enrichment row — rendered only when the cron
                  has populated year_built / home_sqft / assessed_value. */}
              {card.propertyLine && (
                <p className="text-[11px] text-muted-foreground/90">
                  <span className="uppercase tracking-wider text-[9px] text-muted-foreground/60 mr-1.5">
                    Property
                  </span>
                  {card.propertyLine}
                </p>
              )}

              {/* Bottom row: value, days ago, tag */}
              <div className="flex items-center justify-between pt-1 gap-2">
                <span className="text-sm font-heading font-normal text-foreground">
                  {card.estimatedValue}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${daysAgoColorClass(card.days)}`}>
                    {daysAgoLabel(card.days)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-muted-foreground">
                    {card.tag}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
