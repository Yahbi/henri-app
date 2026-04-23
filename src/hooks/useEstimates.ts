"use client";

import { useState, useEffect, useCallback } from "react";

export interface Estimate {
  id: string;
  lead_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  description: string | null;
  line_items: EstimateLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface UseEstimatesReturn {
  estimates: Estimate[];
  total: number;
  isLoading: boolean;
  error: string | null;
  createEstimate: (data: Partial<Estimate>) => Promise<{ success: boolean; error?: string }>;
  updateEstimate: (id: string, data: Partial<Estimate>) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useEstimates(): UseEstimatesReturn {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEstimates = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/estimates");

      if (!res.ok) {
        setEstimates([]);
        setTotal(0);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      const fetched: Estimate[] = data.estimates ?? [];
      setEstimates(fetched);
      setTotal(data.total ?? fetched.length);
    } catch {
      // API not available — return clean defaults
      setEstimates([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const createEstimate = useCallback(
    async (data: Partial<Estimate>): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/estimates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to create estimate" };
        }

        await fetchEstimates();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchEstimates]
  );

  const updateEstimate = useCallback(
    async (id: string, data: Partial<Estimate>): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/estimates/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to update estimate" };
        }

        await fetchEstimates();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchEstimates]
  );

  return {
    estimates,
    total,
    isLoading,
    error,
    createEstimate,
    updateEstimate,
    refresh: fetchEstimates,
  };
}
