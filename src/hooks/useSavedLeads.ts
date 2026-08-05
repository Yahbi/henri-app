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
 * dependency, and the same module-scope shared store + pub/sub so the
 * drawer's Save toggle is reflected in the LeadsPanel's "Saved" filter
 * (and stays correct when the same lead is reopened in-session).
 *
 * Returns an empty set when migration 00090 isn't applied yet or RLS
 * denies the query — never throws, never breaks the panel render.
 */

let sharedSaved = new Set<string>();
const savedListeners = new Set<(s: Set<string>) => void>();

function setSharedSaved(next: Set<string>) {
  sharedSaved = next;
  savedListeners.forEach((l) => l(next));
}

export function useSavedLeads() {
  const [savedIds, setSavedIds] = useState<Set<string>>(sharedSaved);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const listener = (s: Set<string>) => setSavedIds(s);
    savedListeners.add(listener);
    return () => {
      savedListeners.delete(listener);
    };
  }, []);

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
        setSharedSaved(new Set());
        return;
      }

      const { data, error } = await supabase
        .from("saved_leads")
        .select("lead_id")
        .eq("contractor_id", user.id);
      if (cancelledRef.current) return;
      if (error) {
        // Migration 00090 missing or RLS denial — graceful-degrade.
        setSharedSaved(new Set());
      } else {
        setSharedSaved(
          new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id)),
        );
      }
    } catch {
      if (!cancelledRef.current) setSharedSaved(new Set());
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

  const add = useCallback((id: string) => {
    setSharedSaved(new Set(sharedSaved).add(id));
  }, []);

  const remove = useCallback((id: string) => {
    const next = new Set(sharedSaved);
    next.delete(id);
    setSharedSaved(next);
  }, []);

  return { savedIds, loading, refetch: fetchSaved, add, remove };
}
