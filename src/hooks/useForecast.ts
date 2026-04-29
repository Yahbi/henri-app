"use client";

import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";

export interface MonthlyTrendPoint {
  month: string;
  revenue: number;
}

export interface ForecastData {
  monthlyTrend: MonthlyTrendPoint[];
  pipelineValue: number;
  projectedRevenue: MonthlyTrendPoint[];
  costPerAcquisition: number;
  ltv: number;
  breakEvenMonths: number | null;
}

interface UseForecastReturn {
  forecast: ForecastData | null;
  isLoading: boolean;
  error: string | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function useForecast(planPrice = 749): UseForecastReturn {
  const { data: leads, isLoading, error: queryError } = useLeads();

  const forecast = useMemo<ForecastData | null>(() => {
    if (!leads || leads.length === 0) return null;

    // Group leads by month based on created_at
    const byMonth: Record<string, number> = {};
    for (const l of leads) {
      const d = new Date(l.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      byMonth[key] = (byMonth[key] ?? 0) + (l.pipeline_value ?? l.permit_value ?? 0);
    }

    // Build last 6 months trend
    const now = new Date();
    const monthlyTrend: MonthlyTrendPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      monthlyTrend.push({ month: MONTH_NAMES[d.getMonth()], revenue: byMonth[key] ?? 0 });
    }

    // Pipeline value = weighted sum over stages the contractor has actually
    // engaged with. Prior formula included every `status='new'` lead, which
    // at god-mode volume produced a nonsensical $499M pipeline with 0
    // quoted — see Phase 2.2. Each stage is weighted by its industry-default
    // win probability so the number reflects *expected* close value, not
    // raw permit values of untouched leads.
    const STAGE_WEIGHT: Record<string, number> = {
      contacted: 0.15,
      quoted: 0.3,
      proposal: 0.4,
    };
    const pipelineValue = leads.reduce((sum, l) => {
      const w = STAGE_WEIGHT[l.status ?? ""] ?? 0;
      if (w === 0) return sum;
      return sum + (l.pipeline_value ?? l.permit_value ?? 0) * w;
    }, 0);

    // Project next 3 months based on recent average
    const recentAvg = monthlyTrend.slice(-3).reduce((s, p) => s + p.revenue, 0) / 3;
    const projectedRevenue: MonthlyTrendPoint[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      projectedRevenue.push({
        month: MONTH_NAMES[d.getMonth()],
        revenue: Math.round(recentAvg * (1 + i * 0.05)),
      });
    }

    const totalRevenue = leads.reduce((s, l) => s + (l.pipeline_value ?? l.permit_value ?? 0), 0);
    const wonLeads = leads.filter((l) => l.status === "won");
    const ltv = wonLeads.length > 0
      ? Math.round(wonLeads.reduce((s, l) => s + (l.pipeline_value ?? l.permit_value ?? 0), 0) / wonLeads.length)
      : Math.round(totalRevenue / leads.length);

    return {
      monthlyTrend,
      pipelineValue,
      projectedRevenue,
      costPerAcquisition: leads.length > 0 ? Math.round(planPrice / (leads.length / 30)) : 0,
      ltv,
      breakEvenMonths: ltv > 0 ? Math.ceil(planPrice / (ltv * 0.063)) : null,
    };
  }, [leads, planPrice]);

  return {
    forecast,
    isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : "Unknown error") : null,
  };
}
