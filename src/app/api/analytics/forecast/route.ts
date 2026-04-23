import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Plan prices in dollars per month (source of truth: CLAUDE.md) */
const PLAN_PRICES: Record<string, number> = {
  founder: 149,
  starter: 749,
  pro: 1499,
  enterprise: 2555,
};

/* Win probability weights by lead status. `new` is deliberately 0 so it
 * does NOT count toward Pipeline Value — "new" is where every scored
 * lead lands before any human interaction, and the contractor has 10k+
 * of them at any time (auto-scored from permit feed). Summing 5% of all
 * permit values bloated the Pipeline Value card to $499M with 0 jobs
 * actually won. Pipeline = work-in-flight, so start counting only once
 * the contractor has made first contact. */
const WIN_PROBABILITY: Record<string, number> = {
  new: 0,
  contacted: 0.15,
  quoted: 0.3,
  proposal: 0.4,
  won: 1.0,
  lost: 0,
  archived: 0,
};

/**
 * Simple linear regression on (x, y) pairs.
 * Returns slope and intercept so we can project forward.
 */
function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };

  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch user profile for plan info */
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    const planPrice = PLAN_PRICES[(profile?.plan as string) ?? "starter"] ?? 749;

    /* Fetch all leads for this contractor */
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, status, pipeline_value, permit_value, won_at, created_at")
      .eq("contractor_id", user.id);

    if (leadsError) throw leadsError;

    const allLeads = leads ?? [];

    /* ── Monthly revenue trend: last 6 months of won lead revenue ── */
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const wonLeads = allLeads.filter(
      (l: Record<string, unknown>) =>
        l.status === "won" &&
        l.won_at &&
        new Date(l.won_at as string) >= sixMonthsAgo
    );

    /* Group won leads by month */
    const monthBuckets: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthBuckets[key] = 0;
    }

    for (const lead of wonLeads) {
      const wonDate = new Date(lead.won_at as string);
      const key = `${wonDate.getFullYear()}-${String(wonDate.getMonth() + 1).padStart(2, "0")}`;
      if (key in monthBuckets) {
        const value =
          (lead.pipeline_value as number | null) ??
          (lead.permit_value as number | null) ??
          0;
        monthBuckets[key] += value;
      }
    }

    const monthlyTrend = Object.entries(monthBuckets).map(([month, revenue]) => ({
      month,
      revenue,
    }));

    /* ── Pipeline weighted value ── */
    const activeLeads = allLeads.filter(
      (l: Record<string, unknown>) => l.status !== "lost" && l.status !== "archived"
    );

    let pipelineValue = 0;
    for (const lead of activeLeads) {
      const value =
        (lead.pipeline_value as number | null) ??
        (lead.permit_value as number | null) ??
        0;
      const prob = WIN_PROBABILITY[(lead.status as string) ?? "new"] ?? 0.05;
      pipelineValue += value * prob;
    }
    pipelineValue = Math.round(pipelineValue);

    /* ── Projected monthly revenue: linear regression on last 6 months ── */
    const regressionPoints = monthlyTrend.map((m, i) => ({
      x: i,
      y: m.revenue,
    }));
    const { slope, intercept } = linearRegression(regressionPoints);

    const projectedRevenue: { month: string; revenue: number }[] = [];
    for (let i = 1; i <= 3; i++) {
      const futureDate = new Date(now);
      futureDate.setMonth(futureDate.getMonth() + i);
      const key = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}`;
      const projected = Math.max(0, Math.round(slope * (6 + i - 1) + intercept));
      projectedRevenue.push({ month: key, revenue: projected });
    }

    /* ── Cost per acquisition: plan price / won leads (last 30 days) ── */
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentWins = allLeads.filter(
      (l: Record<string, unknown>) =>
        l.status === "won" &&
        l.won_at &&
        new Date(l.won_at as string) >= thirtyDaysAgo
    );

    const costPerAcquisition =
      recentWins.length > 0
        ? Math.round(planPrice / recentWins.length)
        : planPrice; /* If no wins, full plan cost per "acquisition" */

    /* ── Lifetime value prediction ── */
    const wonAllTime = allLeads.filter((l: Record<string, unknown>) => l.status === "won");
    const avgDealSize =
      wonAllTime.length > 0
        ? wonAllTime.reduce((sum: number, l: Record<string, unknown>) => {
            const v =
              (l.pipeline_value as number | null) ??
              (l.permit_value as number | null) ??
              0;
            return sum + v;
          }, 0) / wonAllTime.length
        : 0;

    /* Annual close rate: projected wins per year based on recent velocity */
    const monthlyWinRate =
      monthlyTrend.length > 0
        ? monthlyTrend.reduce((s, m) => s + m.revenue, 0) /
          monthlyTrend.length /
          (avgDealSize || 1)
        : 0;
    const annualCloseRate = monthlyWinRate * 12;
    const ltv = Math.round(avgDealSize * annualCloseRate);

    /* ── Break-even point ── */
    const avgMonthlyRevenue =
      monthlyTrend.length > 0
        ? monthlyTrend.reduce((s, m) => s + m.revenue, 0) / monthlyTrend.length
        : 0;

    let breakEvenMonths: number | null = null;
    if (avgMonthlyRevenue > planPrice) {
      /* Cumulative revenue exceeds cumulative cost: solve for month */
      /* Revenue accumulates at avgMonthlyRevenue/mo, cost at planPrice/mo */
      /* Already profitable each month, so break-even = 1 */
      breakEvenMonths = 1;
    } else if (avgMonthlyRevenue > 0 && slope > 0) {
      /* With growth, find when cumulative revenue surpasses cumulative cost */
      let cumulativeRevenue = 0;
      let cumulativeCost = 0;
      for (let m = 0; m < 60; m++) {
        const monthRevenue = Math.max(0, slope * (6 + m) + intercept);
        cumulativeRevenue += monthRevenue;
        cumulativeCost += planPrice;
        if (cumulativeRevenue >= cumulativeCost) {
          breakEvenMonths = m + 1;
          break;
        }
      }
    }
    /* If still null, not enough data or revenue to project break-even */

    return NextResponse.json(
      {
        monthlyTrend,
        pipelineValue,
        projectedRevenue,
        costPerAcquisition,
        ltv,
        breakEvenMonths,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Forecast API error:", err);
    return NextResponse.json(
      { error: "Failed to compute forecast" },
      { status: 500 }
    );
  }
}
