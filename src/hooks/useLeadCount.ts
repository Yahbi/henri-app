"use client";

import { useQuery } from "@tanstack/react-query";

interface LeadCount {
  total: number;
  geocoded: number;
}

/**
 * Returns the signed-in contractor's total + geocoded lead counts. Used by
 * the dashboard panel and map filter bar to surface "X of ~Y" so the user
 * always sees how much data the app is paging vs. how much exists.
 */
export function useLeadCount(): LeadCount {
  const { data } = useQuery({
    queryKey: ["leads", "count"],
    queryFn: async (): Promise<LeadCount> => {
      try {
        const res = await fetch("/api/leads/count");
        if (!res.ok) return { total: 0, geocoded: 0 };
        return (await res.json()) as LeadCount;
      } catch {
        return { total: 0, geocoded: 0 };
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return data ?? { total: 0, geocoded: 0 };
}
