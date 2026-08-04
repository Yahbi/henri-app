"use client";

import { useEffect, useState, useMemo } from "react";
import { useLeadCount } from "@/hooks/useLeadCount";
import { useLeads } from "@/hooks/useLeads";
import { useUser } from "@/hooks/useUser";
import { useIntelligence } from "@/hooks/useIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, MapPin, Zap, BarChart3, Loader2 } from "lucide-react";
import { formatCurrency } from "@/types/lead";

/* ─── Plan prices ─── */
const PLAN_PRICES: Record<string, number> = {
  founder: 149,
  starter: 749,
  pro: 1499,
  enterprise: 2555,
};

/* ─── Source colors ─── */
const SOURCE_COLORS = [
  "#D4886A", "#3D9970", "#4A7FC0", "#D4A24A", "#9B59B6",
  "#E74C3C", "#1ABC9C", "#F39C12", "#8E44AD", "#2C3E50",
];

/* ─── Components ─── */
function SourceBar({ data, planPrice }: { data: { source: string; count: number }[]; planPrice: number }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
        const cpl = d.count > 0 ? planPrice / d.count : 0;
        const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
        return (
          <div key={d.source} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground font-medium">{d.source}</span>
              <span className="text-muted-foreground">{d.count} leads</span>
            </div>
            <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <div className="flex justify-end text-[10px] text-muted-foreground">
              <span>~{formatCurrency(cpl)} CPL</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ROIPage() {
  const { profile } = useUser();
  const { data: leadsRaw, isLoading: leadsLoading, error: leadsError, refetch: refetchLeads } = useLeads();
  const { data: intel, isLoading: intelLoading } = useIntelligence();
  const leads = useMemo(() => leadsRaw ?? [], [leadsRaw]);

  const planPrice = profile?.plan ? (PLAN_PRICES[profile.plan] ?? 749) : 749;
  const leadCount = useLeadCount();

  const [tab, setTab] = useState<"calculator" | "intelligence" | "territory">("intelligence");

  /* ─── Calculator state (persisted to localStorage) ─── */
  // Hydrate from localStorage on mount, save on every change. Avoids a
  // schema migration for something this small; can promote to
  // profiles.roi_prefs if it becomes multi-device critical.
  const STORAGE_KEY = "henri.roi_prefs.v1";
  const [plan, setPlan] = useState(planPrice);
  const [jobValue, setJobValue] = useState(12000);
  const [closeRate, setCloseRate] = useState(18); // 18% = national baseline (src/lib/scoring/model.ts NATIONAL_BASELINE)
  // Default to real leads-per-month (geocoded / 12) instead of a hardcoded 15.
  // Fallback to 15 if the count hook hasn't loaded yet.
  const initialLeadsPerMonth = leadCount.geocoded > 0
    ? Math.max(1, Math.round(leadCount.geocoded / 12))
    : 15;
  const [leadsPerMonth, setLeadsPerMonth] = useState(initialLeadsPerMonth);

  // Hydrate from localStorage if present (client-side only).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount-once hydration from localStorage; cannot derive at render (SSR mismatch)
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<{
        plan: number; jobValue: number; closeRate: number; leadsPerMonth: number;
      }>;
      if (typeof parsed.plan === "number") setPlan(parsed.plan);
      if (typeof parsed.jobValue === "number") setJobValue(parsed.jobValue);
      if (typeof parsed.closeRate === "number") setCloseRate(parsed.closeRate);
      if (typeof parsed.leadsPerMonth === "number") setLeadsPerMonth(parsed.leadsPerMonth);
    } catch {
      /* malformed — ignore, use defaults */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Persist whenever a slider moves.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ plan, jobValue, closeRate, leadsPerMonth }),
    );
  }, [plan, jobValue, closeRate, leadsPerMonth]);

  const closedDeals = (leadsPerMonth * closeRate) / 100;
  const monthlyRevenue = closedDeals * jobValue;
  const annualRevenue = monthlyRevenue * 12;
  const costPerLead = leadsPerMonth > 0 ? plan / leadsPerMonth : 0;
  const roiMultiplier = plan > 0 ? monthlyRevenue / plan : 0;

  /* ─── Territory performance from real leads ─── */
  const territoryStats = useMemo(() => {
    /* Prefer API data if available */
    if (intel?.territoryPerformance && intel.territoryPerformance.length > 0) {
      return intel.territoryPerformance.sort((a, b) => b.leads - a.leads);
    }

    /* Fallback to client-side computation */
    if (!leads.length) return [];
    const byZip: Record<string, { total: number; contacted: number; won: number; revenue: number }> = {};
    for (const l of leads) {
      const z = l.zip ?? "Unknown";
      if (!byZip[z]) byZip[z] = { total: 0, contacted: 0, won: 0, revenue: 0 };
      byZip[z].total++;
      if (["contacted", "quoted", "proposal", "won"].includes(l.status)) byZip[z].contacted++;
      if (l.status === "won") {
        byZip[z].won++;
        byZip[z].revenue += l.pipeline_value ?? l.permit_value ?? 0;
      }
    }
    return Object.entries(byZip)
      .map(([zip, d]) => ({
        zip,
        leads: d.total,
        contacted: d.contacted,
        won: d.won,
        revenue: d.revenue,
        contactRate: d.total > 0 ? Math.round((d.contacted / d.total) * 100) : 0,
        closeRate: d.contacted > 0 ? Math.round((d.won / d.contacted) * 100) : 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [leads, intel]);

  /* ─── Intelligence data (API-first, sample fallback) ─── */
  const summary = intel?.summary ?? null;
  const categories = intel?.categories ?? [];
  const leadSources = intel?.leadSources ?? [];
  const hottestZips = intel?.hottestZips ?? [];

  const topCategory = categories.length > 0 ? categories[0] : null;
  const topZip = hottestZips.length > 0 ? hottestZips[0] : null;

  /* Current month name */
  const monthName = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">ROI & Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">Track returns, territory performance, and market insights</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle w-fit">
        {([
          { key: "intelligence", label: "Henri Intelligence", icon: Zap },
          { key: "territory", label: "Territory Performance", icon: MapPin },
          { key: "calculator", label: "ROI Calculator", icon: BarChart3 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ─── Henri Intelligence Tab ─── */}
      {tab === "intelligence" && (
        <>
          {/* Monthly Intel Report Card */}
          <Card className="border-primary/20 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-heading font-normal text-foreground">Monthly Intelligence Report</h2>
              <span className="text-xs text-muted-foreground">{monthName}</span>
              {intelLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Permits Filed</p>
                {!intelLoading && summary ? (
                  <>
                    <p className="text-2xl font-heading font-normal text-foreground">{summary.permitsThisMonth}</p>
                    {summary.momChange !== null && (
                      <span className={`inline-flex items-center gap-0.5 text-xs ${summary.momChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {summary.momChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {summary.momChange >= 0 ? "+" : ""}{summary.momChange}% vs. last month
                      </span>
                    )}
                  </>
                ) : (
                  <Skeleton className="h-8 w-16" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg. Project Value</p>
                {!intelLoading && summary ? (
                  <>
                    <p className="text-2xl font-heading font-normal text-foreground">
                      {/* formatCurrency scales into $X.XM past a million \u2014
                          the old inline `/1000 + "K"` rendered a $10.07M
                          commercial average as the unreadable "$10070K". */}
                      {summary.avgProjectValue ? formatCurrency(summary.avgProjectValue) : "\u2014"}
                    </p>
                    <p className="text-xs text-muted-foreground">In your territories</p>
                  </>
                ) : (
                  <Skeleton className="h-8 w-16" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Top Category</p>
                {!intelLoading && summary ? (
                  <>
                    <p className="text-lg font-heading font-normal text-foreground">
                      {topCategory?.name ?? "\u2014"}
                    </p>
                    {topCategory && summary.permitsThisMonth > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {Math.round((topCategory.count / summary.permitsThisMonth) * 100)}% of permits
                      </p>
                    )}
                  </>
                ) : (
                  <Skeleton className="h-8 w-24" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Hottest ZIP</p>
                {!intelLoading && summary ? (
                  <>
                    <p className="text-2xl font-heading font-normal text-primary">
                      {topZip?.zip ?? "\u2014"}
                    </p>
                    {topZip && (
                      <p className="text-xs text-muted-foreground">{topZip.permits} permits this month</p>
                    )}
                  </>
                ) : (
                  <Skeleton className="h-8 w-16" />
                )}
              </div>
            </div>

            {/* Year-over-year if available */}
            {!intelLoading && summary && summary.yoyChange !== null && (
              <div className="pt-2 border-t border-border">
                <span className={`inline-flex items-center gap-1 text-xs ${summary.yoyChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.yoyChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {summary.yoyChange >= 0 ? "+" : ""}{summary.yoyChange}% year-over-year
                </span>
              </div>
            )}
          </Card>

          {/* Lead Source Breakdown + Market Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-base font-heading font-normal text-foreground mb-4">Lead Source Performance</h3>
              {!intelLoading && summary && leadSources.length > 0 ? (
                <SourceBar data={leadSources} planPrice={planPrice} />
              ) : intelLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No lead source data available yet
                </p>
              )}
            </Card>

            {/* Category breakdown */}
            <Card className="p-6 space-y-4">
              <h3 className="text-base font-heading font-normal text-foreground">Permit Categories</h3>
              {!intelLoading && summary && categories.length > 0 ? (
                <div className="space-y-3">
                  {categories.slice(0, 6).map((cat, i) => (
                    <div key={cat.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                        />
                        <span className="text-sm text-foreground">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">{cat.count}</span>
                        {cat.totalValue > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ${(cat.count > 0 ? (cat.totalValue / cat.count / 1000).toFixed(0) : 0)}K avg
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : intelLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full rounded" />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No category data available yet
                </p>
              )}
            </Card>
          </div>

          {/* Hottest ZIPs */}
          {!intelLoading && summary && hottestZips.length > 1 && (
            <Card className="p-6">
              <h3 className="text-base font-heading font-normal text-foreground mb-3">Demand Heatmap</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {hottestZips.map((z) => (
                  <div key={z.zip} className="rounded-lg bg-bg-subtle p-3 text-center space-y-1">
                    <p className="text-lg font-heading font-normal text-foreground">{z.zip}</p>
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(z.permits / hottestZips[0].permits) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{z.permits} permits</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ─── Territory Performance Tab ─── */}
      {tab === "territory" && (
        <>
          {(leadsLoading || intelLoading) ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : territoryStats.length > 0 ? (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle">
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">ZIP Code</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Leads</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Contact Rate</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Close Rate</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Revenue</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {territoryStats.map((row) => {
                    const perf = row.closeRate >= 30 ? "strong" : row.closeRate >= 15 ? "average" : "weak";
                    return (
                      <tr key={row.zip} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3">
                          <span className="text-foreground font-medium">{row.zip}</span>
                        </td>
                        <td className="px-4 py-3 text-foreground">{row.leads}</td>
                        <td className="px-4 py-3 text-foreground">{row.contactRate}%</td>
                        <td className="px-4 py-3 text-foreground">{row.closeRate}%</td>
                        <td className="px-4 py-3 text-foreground">{formatCurrency(row.revenue)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            perf === "strong" ? "bg-green-500/10 text-green-400" :
                            perf === "average" ? "bg-yellow-500/10 text-yellow-400" :
                            "bg-red-500/10 text-red-400"
                          }`}>
                            {perf === "strong" ? "Strong" : perf === "average" ? "Average" : "Needs Work"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ) : leadsError ? (
            /* Fetch failed — alert-with-retry INSTEAD of the empty state,
             * so a DB hiccup doesn't read as "no territory data". */
            <Card role="alert" className="flex items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load territory performance &mdash; check your connection and retry.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchLeads()}>
                Retry
              </Button>
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border rounded-xl text-center">
              <MapPin className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No territory data yet</p>
              <p className="text-xs text-muted-foreground mt-1">Lead data will populate as your territories generate leads.</p>
            </div>
          )}

          {/* Top Performing ZIPs */}
          {territoryStats.length > 0 && (
            <Card className="p-6">
              <h3 className="text-base font-heading font-normal text-foreground mb-3">Top Performing ZIPs</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {territoryStats.slice(0, 3).map((zip, i) => (
                  <div key={zip.zip} className="rounded-lg bg-bg-subtle p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                        i === 0 ? "bg-primary" : i === 1 ? "bg-[#D4A24A]" : "bg-[#4A7FC0]"
                      }`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-foreground">ZIP {zip.zip}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{zip.leads} leads · {zip.closeRate}% close rate</p>
                    <p className="text-lg font-heading font-normal text-foreground">{formatCurrency(zip.revenue)}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ─── ROI Calculator Tab ─── */}
      {tab === "calculator" && (
        <>
          <Card className="p-6 space-y-5">
            <h2 className="text-lg font-heading font-normal text-foreground">Your Business Numbers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Monthly Subscription</label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value={149}>Founder -- $149/mo</option>
                  <option value={749}>Starter -- $749/mo</option>
                  <option value={1499}>Pro -- $1,499/mo</option>
                  <option value={2555}>Enterprise -- $2,555/mo</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Average Job Value ($)</label>
                <input type="number" value={jobValue} onChange={(e) => setJobValue(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Close Rate (%)</label>
                <input type="number" value={closeRate} onChange={(e) => setCloseRate(Number(e.target.value))} min={0} max={100}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Leads Per Month</label>
                <input type="number" value={leadsPerMonth} onChange={(e) => setLeadsPerMonth(Number(e.target.value))} min={0}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
          </Card>

          <div>
            <h2 className="text-lg font-heading font-normal text-foreground mb-4">Your Projected Returns</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-5 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Revenue</p>
                <p className="text-2xl font-heading font-normal text-primary">{formatCurrency(monthlyRevenue)}</p>
                <p className="text-xs text-muted-foreground">{closedDeals.toFixed(1)} closed deals/mo</p>
              </Card>
              <Card className="p-5 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Annual Revenue</p>
                <p className="text-2xl font-heading font-normal text-primary">{formatCurrency(annualRevenue)}</p>
                <p className="text-xs text-muted-foreground">Projected 12-month total</p>
              </Card>
              <Card className="p-5 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Cost Per Lead</p>
                <p className="text-2xl font-heading font-normal text-primary">{formatCurrency(costPerLead)}</p>
                <p className="text-xs text-muted-foreground">Based on {leadsPerMonth} leads/mo</p>
              </Card>
              <Card className="p-5 space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">ROI Multiplier</p>
                <p className="text-2xl font-heading font-normal text-primary">{roiMultiplier.toFixed(1)}x</p>
                <p className="text-xs text-muted-foreground">Return on {formatCurrency(plan)}/mo investment</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
