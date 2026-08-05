"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";

/* The row shape is owned by the route that produces it. This module used to
 * re-declare it, and the two copies drifted: the local copy named the fields
 * `total_reviews` / `total_jobs_won` / `verified` while the route has always
 * returned `review_count` / `jobs_completed`, so every consumer read
 * `undefined` and rendered zeros. `import type` is erased at compile time, so
 * nothing from the route module reaches the client bundle. */
import type { ContractorSearchResult } from "@/app/api/contractors/search/route";

export type { ContractorSearchResult };

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
      /* The route rejects anything but a complete 5-digit ZIP (isZip5), so a
       * 3- or 4-character prefix was a guaranteed 400 that surfaced as
       * "Failed to search contractors" mid-typing. Wait for the full ZIP. */
      const trimmedZip = searchZip.trim();
      if (!/^\d{5}$/.test(trimmedZip)) {
        setContractors([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      const currentId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ zip: trimmedZip });
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
        logger.error("useContractorSearch error", { error: err instanceof Error ? err.message : String(err) });
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
