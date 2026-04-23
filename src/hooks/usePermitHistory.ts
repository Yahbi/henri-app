"use client";

import { useEffect, useRef, useState } from "react";

export interface PermitHistoryRow {
  id: string;
  permit_number: string | null;
  permit_type: string | null;
  status: string | null;
  description: string | null;
  applied_date: string | null;
  issued_date: string | null;
  completed_date: string | null;
  estimated_value: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Fetch every permit on file for a property address. Used by the
 * lead-detail drawer so contractors see the full project history —
 * prior remodels, multi-phase construction, cascade signals — not just
 * the currently-open lead.
 *
 * Cancellation-safe (refs prevent setState on unmounted components).
 * Dedupes by `${address}|${zip}` so rapid drawer swaps don't refetch
 * the same property twice.
 */
export function usePermitHistory(query: {
  address?: string | null;
  zip?: string | null;
  excludeId?: string | null;
} | null) {
  const [permits, setPermits] = useState<PermitHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const addr = query?.address?.trim();
    if (!addr) {
      setPermits([]);
      lastKey.current = null;
      return;
    }

    const key = `${addr}|${query?.zip ?? ""}|${query?.excludeId ?? ""}`;
    if (lastKey.current === key) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ address: addr });
        if (query?.zip) params.set("zip", query.zip);
        if (query?.excludeId) params.set("excludeId", query.excludeId);
        const res = await fetch(`/api/permits/history?${params}`);
        if (!res.ok) {
          if (!cancelled) setPermits([]);
          return;
        }
        const body = (await res.json()) as { permits: PermitHistoryRow[] };
        if (!cancelled) {
          lastKey.current = key;
          setPermits(body.permits ?? []);
        }
      } catch {
        if (!cancelled) setPermits([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query?.address, query?.zip, query?.excludeId]);

  return { permits, isLoading };
}
