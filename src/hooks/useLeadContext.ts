"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedEnrichments } from "@/lib/enrichment/derived";

export interface LeadContextStorm {
  type: string;
  date: string;
  days_between: number;
  magnitude: number | null;
}

export interface LeadContextData {
  derived: DerivedEnrichments;
  adjacent_count_90d: number;
  storm: LeadContextStorm | null;
}

/**
 * Fetch the property-context layer for a lead — derived equipment
 * ages (roof / HVAC / pool / solar / panel), neighborhood permit
 * activity, and any recent storm event in the same ZIP. All three
 * compose data Henri already has on hand; no vendor calls fire.
 *
 * Pairs with `/api/leads/[id]/context` (Phase 0 of the free-tier
 * data expansion).
 *
 * Cancellation-safe (refs prevent setState on unmounted components).
 * Dedupes by lead `id` so rapid drawer swaps don't refetch the same
 * lead twice. On error or 404, returns null context — the drawer
 * silently renders without the new section, never blocks.
 */
export function useLeadContext(leadId: string | null | undefined) {
  const [data, setData] = useState<LeadContextData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setData(null);
      lastId.current = null;
      return;
    }
    if (lastId.current === leadId) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/leads/${encodeURIComponent(leadId)}/context`,
        );
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const body = (await res.json()) as LeadContextData;
        if (!cancelled) {
          lastId.current = leadId;
          setData(body);
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return { data, isLoading };
}
