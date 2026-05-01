"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedEnrichments } from "@/lib/enrichment/derived";

export interface LeadContextStorm {
  type: string;
  date: string;
  days_between: number;
  magnitude: number | null;
}

/** Wave 1.5 — single SWDI signature within 25mi/30d of the lead. */
export interface SwdiNearby {
  kind: "hail" | "wind" | "tornado";
  event_time: string;
  miles_away: number;
  max_size_mm?: number | null;
  max_wind_mph?: number | null;
  probability?: number | null;
}

/** Wave 1.5 — recent CourtListener mechanic-lien docket. */
export interface RecentLien {
  case_name: string | null;
  date_filed: string | null;
  court: string | null;
  docket_number: string | null;
  absolute_url: string | null;
  snippet: string | null;
}

export interface LeadContextData {
  derived: DerivedEnrichments;
  adjacent_count_90d: number;
  storm: LeadContextStorm | null;
  /** Wave 1.5 — nullable because pre-update API responses don't ship it. */
  swdi_nearby?: SwdiNearby[];
  recent_liens?: RecentLien[];
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
