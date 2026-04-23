"use client";

import { useState, useEffect, useCallback } from "react";

export interface FinancingStats {
  total_quotes: number;
  quotes_with_financing: number;
  avg_ticket_size: number;
  avg_financed_ticket: number;
  approval_rate: number;
}

export interface FinancingDeal {
  id: string;
  quote_id: string;
  financing_partner: string;
  monthly_payment: number;
  term_months: number;
  apr: number;
  status: string;
  created_at: string;
}

export interface SaveFinancingData {
  quote_id: string;
  financing_partner: string;
  monthly_payment: number;
  term_months: number;
  apr: number;
}

interface UseFinancingReturn {
  stats: FinancingStats;
  deals: FinancingDeal[];
  isLoading: boolean;
  error: string | null;
  saveFinancing: (data: SaveFinancingData) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const defaultStats: FinancingStats = {
  total_quotes: 0,
  quotes_with_financing: 0,
  avg_ticket_size: 0,
  avg_financed_ticket: 0,
  approval_rate: 0,
};

export function useFinancing(): UseFinancingReturn {
  const [stats, setStats] = useState<FinancingStats>(defaultStats);
  const [deals, setDeals] = useState<FinancingDeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFinancing = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/financing");

      if (!res.ok) {
        setStats(defaultStats);
        setDeals([]);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setStats(data.stats ?? defaultStats);
      setDeals(data.deals ?? []);
    } catch {
      // API not available — return clean defaults
      setStats(defaultStats);
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFinancing();
  }, [fetchFinancing]);

  const saveFinancing = useCallback(
    async (data: SaveFinancingData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/financing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to save financing" };
        }

        await fetchFinancing();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchFinancing]
  );

  return {
    stats,
    deals,
    isLoading,
    error,
    saveFinancing,
    refresh: fetchFinancing,
  };
}
