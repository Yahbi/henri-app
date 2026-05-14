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

/** Wave 2.A — FEMA NRI risk for the lead's county. */
export interface NriRisk {
  risk_score: number;
  risk_rating: string | null;
  matched_on: string;
}

/** Wave 2.B — NFIP flood-claim history in the lead's ZIP. */
export interface NfipHistory {
  claim_count: number;
  latest_year: number | null;
  top_causes: string[];
}

/** Wave 2.B — recent FEMA disaster declaration affecting the lead's state. */
export interface RecentDisaster {
  fema_id: string;
  disaster_number: number | null;
  declaration_type: string | null;
  declaration_date: string | null;
  incident_type: string | null;
  declaration_title: string | null;
}

export interface LeadContextData {
  derived: DerivedEnrichments;
  adjacent_count_90d: number;
  storm: LeadContextStorm | null;
  /** Wave 1.5 — nullable because pre-update API responses don't ship it. */
  swdi_nearby?: SwdiNearby[];
  recent_liens?: RecentLien[];
  /** Wave 2.A/2.B — also nullable for backward compat. */
  nri_risk?: NriRisk | null;
  nfip_history?: NfipHistory | null;
  recent_disasters?: RecentDisaster[];
  /** Module 7 — ISO timestamp when the lead entered its CURRENT stage.
   *  Drives the "for 12d" duration badge on IntentChip. Optional
   *  because pre-migration 00092 responses don't include it. */
  stage_entered_at?: string | null;
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
