"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface ContractorSearchResult {
  id: string;
  company_name: string;
  full_name: string | null;
  trade: string | null;
  phone: string | null;
  avg_rating: number | null;
  total_reviews: number;
  total_jobs_won: number;
  zip: string;
  verified: boolean;
}

interface UseContractorSearchReturn {
  contractors: ContractorSearchResult[];
  isLoading: boolean;
  error: string | null;
}

export function useContractorSearch(
  zip: string,
  trade?: string,
  sort?: string
): UseContractorSearchReturn {
  const [contractors, setContractors] = useState<ContractorSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Debounce timer ref */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Track the latest request to avoid stale responses */
  const requestIdRef = useRef(0);

  const fetchContractors = useCallback(
    async (searchZip: string, searchTrade?: string, searchSort?: string) => {
      /* Require at least a partial ZIP to search */
      if (!searchZip || searchZip.length < 3) {
        setContractors([]);
        setIsLoading(false);
        return;
      }

      const currentId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ zip: searchZip });
        if (searchTrade) params.set("trade", searchTrade);
        if (searchSort) params.set("sort", searchSort);

        const res = await fetch(`/api/contractors/search?${params.toString()}`);

        /* Discard if a newer request was issued */
        if (currentId !== requestIdRef.current) return;

        if (!res.ok) {
          if (res.status === 401) {
            setContractors([]);
            setIsLoading(false);
            return;
          }
          throw new Error("Failed to search contractors");
        }

        const data = await res.json();
        setContractors(data.contractors ?? []);
      } catch (err) {
        if (currentId !== requestIdRef.current) return;
        console.error("useContractorSearch error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setContractors([]);
      } finally {
        if (currentId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  /* Debounce the zip input (300ms), re-fetch immediately on trade/sort change */
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      fetchContractors(zip, trade, sort);
    }, 300);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [zip, trade, sort, fetchContractors]);

  return { contractors, isLoading, error };
}
