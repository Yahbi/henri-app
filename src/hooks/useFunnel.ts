"use client";

import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";
import type { Lead } from "@/types/lead";

export interface FunnelStage {
  name: string;
  count: number;
  rate: number;
  avgDays: number | null;
  dropoff: number;
}

export interface FunnelOverall {
  totalLeads: number;
  totalWon: number;
  totalLost: number;
  conversionRate: number;
  avgCycleDays: number | null;
  avgContactDays: number | null;
  avgCloseFromContactDays: number | null;
}

export interface FunnelData {
  stages: FunnelStage[];
  overall: FunnelOverall;
}

interface UseFunnelReturn {
  funnel: FunnelData | null;
  isLoading: boolean;
  error: string | null;
}

function avgDaysField(leads: Lead[], dateField: "contacted_at" | "won_at"): number | null {
  const valid = leads.filter((l) => l[dateField] && l.created_at);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, l) => {
    const start = new Date(l.created_at).getTime();
    const end = new Date(l[dateField]!).getTime();
    return sum + (end - start) / 86_400_000;
  }, 0);
  return Math.round(total / valid.length);
}

export function useFunnel(): UseFunnelReturn {
  const { data: leads, isLoading, error: queryError } = useLeads();

  const funnel = useMemo<FunnelData | null>(() => {
    if (!leads || leads.length === 0) return null;

    const total = leads.length;
    const byStatus: Record<string, Lead[]> = {};
    for (const l of leads) {
      (byStatus[l.status] ??= []).push(l);
    }

    const contactedCount = (byStatus["contacted"]?.length ?? 0);
    const quotedCount = (byStatus["quoted"]?.length ?? 0) + (byStatus["proposal"]?.length ?? 0);
    const wonCount = (byStatus["won"]?.length ?? 0);
    const lostCount = (byStatus["lost"]?.length ?? 0);

    const stages: FunnelStage[] = [
      { name: "New", count: total, rate: 100, avgDays: null, dropoff: 0 },
      {
        name: "Contacted",
        count: contactedCount + quotedCount + wonCount,
        rate: ((contactedCount + quotedCount + wonCount) / total) * 100,
        avgDays: avgDaysField(leads.filter((l) => l.contacted_at), "contacted_at"),
        dropoff: ((total - contactedCount - quotedCount - wonCount) / total) * 100,
      },
      {
        name: "Quoted",
        count: quotedCount + wonCount,
        rate: ((quotedCount + wonCount) / total) * 100,
        avgDays: null,
        dropoff: contactedCount + quotedCount + wonCount > 0
          ? (((contactedCount + quotedCount + wonCount) - (quotedCount + wonCount)) / (contactedCount + quotedCount + wonCount)) * 100
          : 0,
      },
      {
        name: "Won",
        count: wonCount,
        rate: (wonCount / total) * 100,
        avgDays: avgDaysField(leads.filter((l) => l.won_at), "won_at"),
        dropoff: quotedCount + wonCount > 0 ? (((quotedCount + wonCount) - wonCount) / (quotedCount + wonCount)) * 100 : 0,
      },
      {
        name: "Lost",
        count: lostCount,
        rate: (lostCount / total) * 100,
        avgDays: null,
        dropoff: 0,
      },
    ];

    const overall: FunnelOverall = {
      totalLeads: total,
      totalWon: wonCount,
      totalLost: lostCount,
      conversionRate: total > 0 ? (wonCount / total) * 100 : 0,
      avgCycleDays: avgDaysField(leads.filter((l) => l.won_at), "won_at"),
      avgContactDays: avgDaysField(leads.filter((l) => l.contacted_at), "contacted_at"),
      avgCloseFromContactDays: null,
    };

    return { stages, overall };
  }, [leads]);

  return {
    funnel,
    isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : "Unknown error") : null,
  };
}
