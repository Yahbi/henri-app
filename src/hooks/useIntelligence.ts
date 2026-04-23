"use client";

import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";

export interface IntelligenceCategory {
  name: string;
  count: number;
  totalValue: number;
}

export interface LeadSource {
  source: string;
  count: number;
}

export interface TerritoryPerformance {
  zip: string;
  leads: number;
  contacted: number;
  won: number;
  revenue: number;
  contactRate: number;
  closeRate: number;
}

export interface HottestZip {
  zip: string;
  permits: number;
}

export interface IntelligenceSummary {
  permitsThisMonth: number;
  permitsLastMonth: number;
  momChange: number | null;
  yoyChange: number | null;
  avgProjectValue: number | null;
  totalLeads: number;
  leadsWon: number;
  totalRevenue: number;
}

export interface IntelligenceData {
  period: string;
  territories: string[];
  summary: IntelligenceSummary | null;
  categories: IntelligenceCategory[];
  leadSources: LeadSource[];
  territoryPerformance: TerritoryPerformance[];
  hottestZips: HottestZip[];
}

interface UseIntelligenceReturn {
  data: IntelligenceData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useIntelligence(): UseIntelligenceReturn {
  const { data: leads, isLoading, error: queryError, refetch } = useLeads();

  const data = useMemo<IntelligenceData | null>(() => {
    if (!leads || leads.length === 0) return null;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    // Permits this month vs last month
    const thisMonthLeads = leads.filter((l) => {
      const d = new Date(l.created_at);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const lastMonthLeads = leads.filter((l) => {
      const d = new Date(l.created_at);
      const lm = thisMonth === 0 ? 11 : thisMonth - 1;
      const ly = thisMonth === 0 ? thisYear - 1 : thisYear;
      return d.getMonth() === lm && d.getFullYear() === ly;
    });

    const permitsThisMonth = thisMonthLeads.length;
    const permitsLastMonth = lastMonthLeads.length;
    const momChange = permitsLastMonth > 0
      ? ((permitsThisMonth - permitsLastMonth) / permitsLastMonth) * 100
      : null;

    const totalValue = leads.reduce((s, l) => s + (l.pipeline_value ?? l.permit_value ?? 0), 0);
    const avgProjectValue = leads.length > 0 ? Math.round(totalValue / leads.length) : null;

    const wonLeads = leads.filter((l) => l.status === "won");
    const totalRevenue = wonLeads.reduce((s, l) => s + (l.pipeline_value ?? l.permit_value ?? 0), 0);

    // Categories by trade
    const tradeMap: Record<string, { count: number; value: number }> = {};
    for (const l of leads) {
      const trade = l.trade ?? "Other";
      const entry = (tradeMap[trade] ??= { count: 0, value: 0 });
      entry.count++;
      entry.value += l.pipeline_value ?? l.permit_value ?? 0;
    }
    const categories: IntelligenceCategory[] = Object.entries(tradeMap)
      .map(([name, { count, value }]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        count,
        totalValue: value,
      }))
      .sort((a, b) => b.count - a.count);

    // Territory performance by ZIP
    const zipMap: Record<string, { leads: number; contacted: number; won: number; revenue: number }> = {};
    for (const l of leads) {
      const zip = l.zip || "Unknown";
      const entry = (zipMap[zip] ??= { leads: 0, contacted: 0, won: 0, revenue: 0 });
      entry.leads++;
      if (["contacted", "quoted", "proposal", "won"].includes(l.status)) entry.contacted++;
      if (l.status === "won") {
        entry.won++;
        entry.revenue += l.pipeline_value ?? l.permit_value ?? 0;
      }
    }

    const territoryPerformance: TerritoryPerformance[] = Object.entries(zipMap)
      .map(([zip, d]) => ({
        zip,
        leads: d.leads,
        contacted: d.contacted,
        won: d.won,
        revenue: d.revenue,
        contactRate: d.leads > 0 ? (d.contacted / d.leads) * 100 : 0,
        closeRate: d.contacted > 0 ? (d.won / d.contacted) * 100 : 0,
      }))
      .sort((a, b) => b.leads - a.leads);

    const territories = [...new Set(leads.map((l) => l.zip).filter(Boolean))];

    const hottestZips: HottestZip[] = territoryPerformance
      .slice(0, 5)
      .map((t) => ({ zip: t.zip, permits: t.leads }));

    return {
      period: "last_90_days",
      territories,
      summary: {
        permitsThisMonth,
        permitsLastMonth,
        momChange: momChange !== null ? Math.round(momChange * 10) / 10 : null,
        yoyChange: null,
        avgProjectValue,
        totalLeads: leads.length,
        leadsWon: wonLeads.length,
        totalRevenue,
      },
      categories,
      leadSources: [{ source: "Live Permits", count: leads.length }],
      territoryPerformance,
      hottestZips,
    };
  }, [leads]);

  return {
    data,
    isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : "Unknown error") : null,
    refresh: async () => { await refetch(); },
  };
}
