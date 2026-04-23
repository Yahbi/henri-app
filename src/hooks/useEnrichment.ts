"use client";

import { useState, useEffect, useRef } from "react";
import type { EnrichmentResult } from "@/lib/enrichment/types";

/**
 * Client-side hook to fetch property enrichment data for a lead.
 * Called when a lead is selected in the detail drawer to enrich
 * with owner/property info from county assessor + Census data.
 */
export function useEnrichment(query: {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number | null;
  lng?: number | null;
} | null) {
  const [data, setData] = useState<EnrichmentResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!query?.address) {
      setData(null);
      return;
    }

    const key = `${query.address}|${query.zip ?? ""}`;
    if (lastKey.current === key) return;

    let cancelled = false;

    async function fetchEnrichment() {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ address: query!.address });
        if (query!.city) params.set("city", query!.city);
        if (query!.state) params.set("state", query!.state);
        if (query!.zip) params.set("zip", query!.zip);
        if (query!.lat) params.set("lat", String(query!.lat));
        if (query!.lng) params.set("lng", String(query!.lng));

        const res = await fetch(`/api/enrichment/property?${params}`);
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }

        const result: EnrichmentResult = await res.json();
        if (!cancelled) {
          lastKey.current = key;
          setData(result.source !== "none" ? result : null);
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchEnrichment();
    return () => { cancelled = true; };
  }, [query?.address, query?.zip, query?.lat, query?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading };
}
