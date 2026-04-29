"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";

export interface PermitDetailRow {
  id: string;
  description: string | null;
  status: string | null;
  applicant_name: string | null;
  contractor_name: string | null;
  applied_date: string | null;
  issued_date: string | null;
  completed_date: string | null;
}

/**
 * Fetch the heavy permit fields the LeadDetailDrawer needs (description,
 * applicant/contractor name, lifecycle dates) on demand when the drawer
 * opens. Used to compensate for `useLeads({ skip_permits_join: true })` in
 * god-mode dashboard pulls, where the dashboard list fetch deliberately
 * omits the `permits(...)` embed to bypass Supabase's 8-second statement
 * timeout (see `~/.claude/plans/composed-questing-lighthouse.md` B1).
 *
 * One round-trip per drawer open is cheap relative to blanket-joining
 * 25,000 permit rows on every list paint. The hook is graceful-degrade:
 * if the permit row isn't found or the fetch errors, we return null and
 * the drawer renders without those fields (the same behavior it would
 * have had pre-migration on a stale lead).
 *
 * Cancellation-safe via the ref-cancelled pattern (CLAUDE.md "every new
 * component that does I/O" rule).
 */
export function usePermitDetail(permitId: string | null | undefined) {
  const [permit, setPermit] = useState<PermitDetailRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!permitId) {
      setPermit(null);
      lastKey.current = null;
      return;
    }
    if (lastKey.current === permitId) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("permits")
          .select(
            "id, description, status, applicant_name, contractor_name, applied_date, issued_date, completed_date",
          )
          .eq("id", permitId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // Graceful-degrade: don't break the drawer if the permit
          // disappeared (rare, but possible with cascading deletes from
          // legacy ingest re-runs).
          logger.warn("usePermitDetail: fetch failed", { permitId, error: error.message });
          setPermit(null);
        } else {
          lastKey.current = permitId;
          setPermit((data as PermitDetailRow) ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          logger.warn("usePermitDetail: unexpected error", { permitId, error: String(e) });
          setPermit(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permitId]);

  return { permit, isLoading };
}
