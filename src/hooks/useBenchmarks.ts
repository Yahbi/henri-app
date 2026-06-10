"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";

export interface Benchmark {
  id: string;
  zip_prefix: string;
  trade: string;
  project_type: string;
  cost_low: number;
  cost_avg: number;
  cost_high: number;
  sample_size: number;
  updated_at: string;
}

interface UseBenchmarksReturn {
  benchmarks: Benchmark[];
  zipPrefix: string;
  isLoading: boolean;
  error: string | null;
}

export function useBenchmarks(
  zip: string,
  trade?: string,
  projectType?: string
): UseBenchmarksReturn {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [zipPrefix, setZipPrefix] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Debounce timer ref */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Track the latest request to avoid stale responses */
  const requestIdRef = useRef(0);

  /* requestIdRef only guards staleness BETWEEN requests — the latest
   * request's response can still land after unmount and setState on an
   * unmounted component. Track unmount explicitly (ref-cancelled pattern,
   * mirrors useEnrichment) and check it before every setState. */
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const fetchBenchmarks = useCallback(
    async (searchZip: string, searchTrade?: string, searchProjectType?: string) => {
      /* Require at least a partial ZIP to search */
      if (!searchZip || searchZip.length < 3) {
        setBenchmarks([]);
        setZipPrefix("");
        setIsLoading(false);
        return;
      }

      const currentId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ zip: searchZip });
        if (searchTrade) params.set("trade", searchTrade);
        if (searchProjectType) params.set("project_type", searchProjectType);

        const res = await fetch(`/api/benchmarks?${params.toString()}`);

        /* Discard if a newer request was issued or we unmounted */
        if (unmountedRef.current || currentId !== requestIdRef.current) return;

        if (!res.ok) {
          throw new Error("Failed to fetch benchmarks");
        }

        const data = await res.json();
        if (unmountedRef.current || currentId !== requestIdRef.current) return;
        setBenchmarks(data.benchmarks ?? []);
        setZipPrefix(data.zip_prefix ?? searchZip.slice(0, 3));
      } catch (err) {
        if (unmountedRef.current || currentId !== requestIdRef.current) return;
        logger.error("useBenchmarks error", { error: err instanceof Error ? err.message : String(err) });
        setError(err instanceof Error ? err.message : "Unknown error");
        setBenchmarks([]);
      } finally {
        if (!unmountedRef.current && currentId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  /* Debounce the zip input (300ms), re-fetch on trade/projectType change */
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      fetchBenchmarks(zip, trade, projectType);
    }, 300);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [zip, trade, projectType, fetchBenchmarks]);

  return { benchmarks, zipPrefix, isLoading, error };
}
