"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from "@/lib/logger";

export interface Quote {
  id: string;
  lead_id: string | null;
  homeowner_id: string;
  contractor_id: string;
  status: "pending" | "sent" | "accepted" | "declined" | "expired";
  description: string;
  amount: number | null;
  notes: string | null;
  response_notes: string | null;
  created_at: string;
  responded_at: string | null;
  expires_at: string | null;
}

export interface QuoteRequestData {
  contractor_id: string;
  description: string;
  trade?: string;
  zip?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  scope_notes?: string;
  lead_id?: string;
}

export interface QuoteResponseData {
  status: "sent" | "accepted" | "declined";
  amount?: number;
  notes?: string;
}

interface UseQuotesReturn {
  quotes: Quote[];
  isLoading: boolean;
  error: string | null;
  requestQuote: (data: QuoteRequestData) => Promise<{ success: boolean; error?: string }>;
  respondToQuote: (
    id: string,
    data: QuoteResponseData
  ) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useQuotes(): UseQuotesReturn {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/quotes");
      if (!res.ok) {
        if (res.status === 401) {
          setQuotes([]);
          setIsLoading(false);
          return;
        }
        throw new Error("Failed to fetch quotes");
      }

      const data = await res.json();
      setQuotes(data.quotes ?? []);
    } catch (err) {
      logger.error("useQuotes fetch error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const requestQuote = useCallback(
    async (data: QuoteRequestData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to request quote" };
        }

        await fetchQuotes();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchQuotes]
  );

  const respondToQuote = useCallback(
    async (
      id: string,
      data: QuoteResponseData
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/quotes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to respond to quote" };
        }

        await fetchQuotes();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchQuotes]
  );

  return {
    quotes,
    isLoading,
    error,
    requestQuote,
    respondToQuote,
    refresh: fetchQuotes,
  };
}
