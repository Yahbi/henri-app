"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Module 8 — fetch the contractor's hidden_leads ids and surface them
 * as a Set for the LeadsPanel filter.
 *
 * The LeadsPanel hides anything whose id is in this set by default.
 * A "Show hidden" toggle in the filter bar reveals them. Pairs with
 * the existing /api/leads/[id]/hide POST endpoint that writes the
 * hidden_leads row when a contractor clicks "Hide" in the drawer.
 *
 * Cancellation-safe + dedupes by contractor (only fires when the
 * authed user changes). Returns an empty set when migration 00090
 * isn't applied yet — graceful-degrade, no UI breakage.
 */
export function useHiddenLeads() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const fetchHidden = useCallback(async () => {
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Check the cancelled ref before EVERY setState — the auth await
      // above can resolve after unmount.
      if (cancelledRef.current) return;
      if (!user) {
        setHiddenIds(new Set());
        return;
      }

      const { data, error } = await supabase
        .from("hidden_leads")
        .select("lead_id")
        .eq("contractor_id", user.id);
      if (cancelledRef.current) return;
      if (error) {
        // Migration 00090 missing or RLS denial — graceful-degrade.
        setHiddenIds(new Set());
      } else {
        setHiddenIds(
          new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id)),
        );
      }
    } catch {
      if (!cancelledRef.current) setHiddenIds(new Set());
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchHidden();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchHidden]);

  return { hiddenIds, loading, refetch: fetchHidden };
}
