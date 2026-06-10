"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Phase AA — fetch the contractor's saved_leads ids and surface them
 * as a Set for the LeadsPanel filter.
 *
 * Pairs with the existing /api/leads/[id]/save POST endpoint that
 * writes the saved_leads row when a contractor clicks "Save" in the
 * drawer (LeadActionButtons). Mirrors `useHiddenLeads` line-for-line —
 * same fetch/cancellation/graceful-degrade shape, same migration-00090
 * dependency.
 *
 * Returns an empty set when migration 00090 isn't applied yet or RLS
 * denies the query — never throws, never breaks the panel render.
 */
export function useSavedLeads() {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const fetchSaved = useCallback(async () => {
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Check the cancelled ref before EVERY setState — the auth await
      // above can resolve after unmount.
      if (cancelledRef.current) return;
      if (!user) {
        setSavedIds(new Set());
        return;
      }

      const { data, error } = await supabase
        .from("saved_leads")
        .select("lead_id")
        .eq("contractor_id", user.id);
      if (cancelledRef.current) return;
      if (error) {
        // Migration 00090 missing or RLS denial — graceful-degrade.
        setSavedIds(new Set());
      } else {
        setSavedIds(
          new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id)),
        );
      }
    } catch {
      if (!cancelledRef.current) setSavedIds(new Set());
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchSaved();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchSaved]);

  return { savedIds, loading, refetch: fetchSaved };
}
