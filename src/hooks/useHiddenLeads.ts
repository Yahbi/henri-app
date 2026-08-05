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
 *
 * SHARED STORE: the set lives at module scope with a tiny pub/sub so
 * every `useHiddenLeads()` instance stays in sync. This matters because
 * the LeadsPanel (which filters the list) and the LeadDetailDrawer
 * (which hides a lead) mount SEPARATE instances — without a shared
 * store, hiding a lead in the drawer wouldn't remove its row from the
 * list until the next refetch. `add`/`remove` are optimistic mutators
 * that propagate to all subscribers immediately.
 */

let sharedHidden = new Set<string>();
const hiddenListeners = new Set<(s: Set<string>) => void>();

function setSharedHidden(next: Set<string>) {
  sharedHidden = next;
  hiddenListeners.forEach((l) => l(next));
}

export function useHiddenLeads() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(sharedHidden);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  // Subscribe to the shared store so optimistic add/remove from any other
  // instance (e.g. the lead drawer) re-renders this consumer.
  useEffect(() => {
    const listener = (s: Set<string>) => setHiddenIds(s);
    hiddenListeners.add(listener);
    return () => {
      hiddenListeners.delete(listener);
    };
  }, []);

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
        setSharedHidden(new Set());
        return;
      }

      const { data, error } = await supabase
        .from("hidden_leads")
        .select("lead_id")
        .eq("contractor_id", user.id);
      if (cancelledRef.current) return;
      if (error) {
        // Migration 00090 missing or RLS denial — graceful-degrade.
        setSharedHidden(new Set());
      } else {
        setSharedHidden(
          new Set((data ?? []).map((r: { lead_id: string }) => r.lead_id)),
        );
      }
    } catch {
      if (!cancelledRef.current) setSharedHidden(new Set());
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

  const add = useCallback((id: string) => {
    setSharedHidden(new Set(sharedHidden).add(id));
  }, []);

  const remove = useCallback((id: string) => {
    const next = new Set(sharedHidden);
    next.delete(id);
    setSharedHidden(next);
  }, []);

  return { hiddenIds, loading, refetch: fetchHidden, add, remove };
}
