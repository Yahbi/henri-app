"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { MetricGrid } from "@/components/analytics/MetricGrid";
import { BenchmarkWidget } from "@/components/dashboard/BenchmarkWidget";
import { StageHistogram } from "@/components/analytics/StageHistogram";
import { useLeads } from "@/hooks/useLeads";
import { useGodMode } from "@/hooks/useGodMode";
import { useUser } from "@/hooks/useUser";
import { useFunnel } from "@/hooks/useFunnel";
import { useForecast } from "@/hooks/useForecast";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ArrowRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

const LeadTrendChart = dynamic(
  () => import("@/components/analytics/LeadTrendChart").then((m) => m.LeadTrendChart),
  { ssr: false, loading: () => <div className="h-[340px] bg-card border border-border rounded-xl animate-pulse" /> }
);

const PLAN_PRICES: Record<string, number> = {
  founder: 149,
  starter: 749,
  pro: 1499,
  enterprise: 2555,
};

/* ─── Funnel Visualization ─── */
function ConversionFunnel({ stages, overall }: {
  stages: { name: string; count: number; rate: number; avgDays: number | null }[];
  overall: { totalLeads: number; totalWon: number; conversionRate: number; avgCycleDays: number | null };
}) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Conversion Funnel</h3>
        <span className="text-xs text-muted-foreground">Last 30 days</span>
      </div>

      <div className="space-y-2">
        {stages.map((stage, i) => {
          const widthPct = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, 8) : 8;
          const isLast = i === stages.length - 1;
          return (
            <div key={stage.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground">{stage.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground font-medium">{stage.count}</span>
                  {stage.rate > 0 && i > 0 && (
                    <span className="text-[10px] text-muted-foreground">{stage.rate}%</span>
                  )}
                  {stage.avgDays !== null && (
                    <span className="text-[10px] text-muted-foreground">{stage.avgDays.toFixed(1)}d avg</span>
                  )}
                </div>
              </div>
              <div className="h-3 rounded-full bg-bg-subtle overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    stage.name === "Won" ? "bg-green-500" :
                    stage.name === "Lost" ? "bg-red-500/50" :
                    "bg-primary"
                  }`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              {!isLast && i < stages.length - 2 && (
                <div className="flex justify-center py-0.5">
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 rotate-90" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Overall stats */}
      <div className="pt-3 border-t border-border grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-lg font-heading font-normal text-primary">{overall.conversionRate}%</p>
          <p className="text-[10px] text-muted-foreground">Win Rate</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-heading font-normal text-foreground">{overall.totalWon}</p>
          <p className="text-[10px] text-muted-foreground">Jobs Won</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-heading font-normal text-foreground">
            {overall.avgCycleDays !== null ? `${overall.avgCycleDays.toFixed(0)}d` : "\u2014"}
          </p>
          <p className="text-[10px] text-muted-foreground">Avg Cycle</p>
        </div>
      </div>
    </Card>
  );
}

/* ─── Revenue Forecast Widget ─── */
function ForecastWidget({ forecast }: { forecast: {
  monthlyTrend: { month: string; revenue: number }[];
  pipelineValue: number;
  projectedRevenue: { month: string; revenue: number }[];
  costPerAcquisition: number | null;
  ltv: number | null;
  breakEvenMonths: number | null;
} }) {
  // Concat real monthlyTrend with the forecast's projected months so the
  // bar chart can visually distinguish history (solid) from projection
  // (dashed outline). `trend.length` used to be compared against itself
  // inside the map — always false — so projected bars never rendered.
  const historyLen = forecast.monthlyTrend.length;
  const trend = [...forecast.monthlyTrend, ...forecast.projectedRevenue];
  const lastMonth = historyLen > 0 ? forecast.monthlyTrend[historyLen - 1].revenue : 0;
  const prevMonth = historyLen > 1 ? forecast.monthlyTrend[historyLen - 2].revenue : 0;
  const trendDir = lastMonth >= prevMonth ? "up" : "down";

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Revenue Forecast</h3>

      {/* Mini trend chart */}
      {trend.length > 0 && (
        <div className="flex items-end gap-1.5 h-16">
          {trend.map((m, i) => {
            const max = Math.max(...trend.map((t) => t.revenue), 1);
            const h = Math.max((m.revenue / max) * 100, 4);
            // Bars past historyLen are projections from the forecast hook.
            const isProjected = i >= historyLen;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className={`w-full rounded-t transition-all ${isProjected ? "bg-primary/30 border border-dashed border-primary" : "bg-primary/70"}`}
                  style={{ height: `${h}%`, minHeight: 3 }}
                />
                <span className="text-[9px] text-muted-foreground">{m.month}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Key metrics */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Pipeline Value</span>
          <span className="text-sm font-medium text-foreground">${forecast.pipelineValue.toLocaleString()}</span>
        </div>
        {forecast.costPerAcquisition !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cost per Win</span>
            <span className="text-sm font-medium text-foreground">${forecast.costPerAcquisition.toFixed(0)}</span>
          </div>
        )}
        {forecast.ltv !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Projected LTV</span>
            <span className="text-sm font-medium text-primary">${forecast.ltv.toLocaleString()}</span>
          </div>
        )}
        {forecast.breakEvenMonths !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Break-Even</span>
            <span className={`text-sm font-medium ${forecast.breakEvenMonths <= 1 ? "text-green-400" : "text-foreground"}`}>
              {forecast.breakEvenMonths <= 0 ? "Already" : `${forecast.breakEvenMonths} mo`}
            </span>
          </div>
        )}
      </div>

      {/* Trend indicator */}
      <div className="pt-2 border-t border-border">
        <span className={`inline-flex items-center gap-1 text-xs ${trendDir === "up" ? "text-green-400" : "text-red-400"}`}>
          {trendDir === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          Revenue {trendDir === "up" ? "trending up" : "declining"} month-over-month
        </span>
      </div>
    </Card>
  );
}

/* ─── Property Age Distribution ─── */

/** Buckets leads by their `year_built` into decade bins and renders a
 * horizontal bar chart. Only populated for leads the county-GIS
 * enrichment cron has touched (currently Hartford CT, DC, LA County,
 * NYC, Sioux Falls SD, NC statewide, MD statewide, Harris TX). */
function PropertyAgeChart({
  leads,
  isLoading = false,
}: {
  leads: Array<{ year_built?: number | null }>;
  isLoading?: boolean;
}) {
  const buckets = useMemo(() => {
    const bins: Record<string, number> = {
      "<1900": 0, "1900s": 0, "1910s": 0, "1920s": 0, "1930s": 0, "1940s": 0,
      "1950s": 0, "1960s": 0, "1970s": 0, "1980s": 0, "1990s": 0, "2000s": 0,
      "2010s": 0, "2020s": 0,
    };
    for (const l of leads) {
      const y = l.year_built;
      if (!y || y < 1700 || y > 2100) continue;
      if (y < 1900) bins["<1900"]++;
      else if (y < 1910) bins["1900s"]++;
      else if (y < 1920) bins["1910s"]++;
      else if (y < 1930) bins["1920s"]++;
      else if (y < 1940) bins["1930s"]++;
      else if (y < 1950) bins["1940s"]++;
      else if (y < 1960) bins["1950s"]++;
      else if (y < 1970) bins["1960s"]++;
      else if (y < 1980) bins["1970s"]++;
      else if (y < 1990) bins["1980s"]++;
      else if (y < 2000) bins["1990s"]++;
      else if (y < 2010) bins["2000s"]++;
      else if (y < 2020) bins["2010s"]++;
      else bins["2020s"]++;
    }
    return bins;
  }, [leads]);

  const entries = Object.entries(buckets);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  // Three render states, in order:
  //   1. Loading        → skeleton (fetch for god-mode is 200k rows, slow)
  //   2. Loaded, 0 hits → honest empty message (enrichment cron hasn't
  //                       reached enough leads yet)
  //   3. Loaded, N hits → the bar chart below
  if (isLoading) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground">Leads by property age</h3>
        <div className="space-y-1.5 mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0">
                <span className="block h-3 w-10 rounded bg-bg-subtle animate-pulse" />
              </span>
              <div className="flex-1 h-4 bg-bg-subtle rounded animate-pulse" />
              <span className="w-10 shrink-0">
                <span className="block h-3 w-6 rounded bg-bg-subtle animate-pulse ml-auto" />
              </span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (total === 0) {
    // Phase 2.7 — honest empty state. Tells the contractor exactly where
    // enrichment data is live today + that we're expanding (rather than
    // silently rendering an empty chart that looks broken).
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground">Leads by property age</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Year-built data is live in CA, CT, DC, MD, NC, NY, SD, and Harris
          County TX. Coverage expands every week as we onboard new
          jurisdictions — chart will populate automatically once your
          leads land in a supported area.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-foreground">Leads by property age</h3>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        {total.toLocaleString()} leads with known year built
      </p>
      <div className="space-y-1.5">
        {entries.map(([bucket, count]) => (
          <div key={bucket} className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 text-muted-foreground">{bucket}</span>
            <div className="flex-1 h-4 bg-bg-subtle rounded overflow-hidden">
              <div
                className="h-full bg-primary/80 rounded"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right tabular-nums text-foreground">{count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AnalyticsPage() {
  // Bump the default 50-row cap so the "Leads by property age" bucket
  // chart has something to render. On paid plans 2k is plenty — it's
  // roughly the Founder/Starter monthly lead volume. God-mode pulls
  // the full account so the chart reflects the real year_built
  // distribution, not a score-ordered slice.
  const godMode = useGodMode();
  const { data: leadsRaw, isLoading: leadsLoading } = useLeads({
    // God-mode: no soft cap so year_built distribution reflects the full
    // account, not a score-ordered slice. 500k = server hard ceiling.
    limit: godMode ? 500_000 : 2000,
    skip_sort: godMode, // planner-friendly; see useLeads paginated branch
  });
  const leads = useMemo(() => leadsRaw ?? [], [leadsRaw]);
  const { profile } = useUser();
  const { funnel, isLoading: funnelLoading } = useFunnel();
  const planPrice = profile?.plan ? (PLAN_PRICES[profile.plan] ?? 749) : 749;
  const { forecast, isLoading: forecastLoading } = useForecast(planPrice);

  // Mount-time "now" so the 30-day window is stable across renders (not a moving target)
  const [mountNow] = useState(() => Date.now());

  const metrics = useMemo(() => {
    if (!leads || leads.length === 0) return null;

    const thirtyDaysAgo = mountNow - 30 * 24 * 60 * 60 * 1000;
    const recent = leads.filter((l) => new Date(l.created_at).getTime() >= thirtyDaysAgo);

    const totalLeads = recent.length;
    const contacted = recent.filter((l) => ["contacted", "quoted", "proposal", "won"].includes(l.status)).length;
    const quoted = recent.filter((l) => ["quoted", "proposal", "won"].includes(l.status)).length;
    const won = recent.filter((l) => l.status === "won");
    const jobsWon = won.length;
    const revenue = won.reduce((sum, l) => sum + (l.pipeline_value ?? l.permit_value ?? 0), 0);

    const contactRate = totalLeads > 0 ? (contacted / totalLeads) * 100 : 0;
    const quoteRate = contacted > 0 ? (quoted / contacted) * 100 : 0;
    const costPerWin = jobsWon > 0 ? planPrice / jobsWon : null;
    const roi = revenue > 0 ? revenue / planPrice : null;

    const responseTimes = recent
      .filter((l) => l.contacted_at)
      .map((l) => (new Date(l.contacted_at!).getTime() - new Date(l.created_at).getTime()) / 3_600_000);
    const avgResponseH = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    return { totalLeads, contactRate, quoteRate, jobsWon, revenue, avgResponseH, costPerWin, roi };
  }, [leads, planPrice, mountNow]);

  const zipDisplay = leads.length > 0
    ? [...new Set(leads.map((l) => l.zip).filter(Boolean))].slice(0, 3).join(", ")
    : "your ZIPs";

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">Analytics</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Last 30 days &middot; {zipDisplay}
        </p>
      </div>

      {/* Zero-leads explainer — a page full of zeros with no cause reads
          as broken. One banner connects the zeros to "no territory yet"
          and routes to the claim surface (/onboarding/territory — same
          target as the dashboard empty state). All sections below stay
          rendered so the layout is familiar when data arrives. */}
      {!leadsLoading && leads.length === 0 && (
        <Card className="p-4 border-primary/30 bg-primary-04">
          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <div className="w-9 h-9 rounded-lg bg-primary-08 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-foreground">
                These metrics are zero because you have no leads yet
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Analytics fill in automatically once leads start flowing
                into an active territory. Claim your first ZIP to begin.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/onboarding/territory">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Claim a territory
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {/* KPI metrics */}
      <MetricGrid
        isLoading={leadsLoading}
        leadsReceived={metrics?.totalLeads}
        contactRate={metrics?.contactRate}
        quoteRate={metrics?.quoteRate}
        jobsWon={metrics?.jobsWon}
        revenue={metrics?.revenue}
        avgResponseH={metrics?.avgResponseH ?? undefined}
        costPerWin={metrics?.costPerWin}
        roi={metrics?.roi}
        planPrice={planPrice}
      />

      {/* Conversion Funnel + Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {funnelLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : funnel ? (
          <ConversionFunnel stages={funnel.stages} overall={funnel.overall} />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">Funnel data will appear as leads progress</p>
          </div>
        )}

        {forecastLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : forecast ? (
          <ForecastWidget forecast={forecast} />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">Revenue forecast requires lead history</p>
          </div>
        )}
      </div>

      {/* ZIP rank — top ZIP by lead count */}
      {(() => {
        const zipCounts = (leads ?? []).reduce<Record<string, number>>((acc, l) => {
          const z = l.zip;
          if (z) acc[z] = (acc[z] ?? 0) + 1;
          return acc;
        }, {});
        const topZip = Object.entries(zipCounts).sort((a, b) => b[1] - a[1])[0];
        return (
          <Card className="p-4 inline-block">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Top ZIP
            </p>
            <p className="text-2xl font-heading font-normal text-foreground mt-1">
              {topZip ? topZip[0] : "\u2014"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {topZip ? `${topZip[1]} lead${topZip[1] !== 1 ? "s" : ""}` : "Not enough data yet"}
            </p>
          </Card>
        );
      })()}

      {/* Benchmark + Chart side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LeadTrendChart />
        </div>
        <BenchmarkWidget />
      </div>

      {/* Module 24 (2026-05-09) — opportunity-stage histogram. Same
          palette as drawer chip / map pin / LeadCard / kanban card. The
          founder pricing premise becomes legible at a glance: terracotta
          stripes are hot leads, green stripes are completed maintenance
          opportunities, etc. */}
      <StageHistogram leads={leads} isLoading={leadsLoading} />

      {/* Property age distribution — sourced from cron/enrich year_built. */}
      <PropertyAgeChart leads={leads} isLoading={leadsLoading} />
    </div>
  );
}
