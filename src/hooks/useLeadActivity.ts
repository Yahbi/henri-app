"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { logger } from "@/lib/logger";

export interface ActivityEvent {
  id: string;
  type:
    | "created"
    | "status_change"
    | "outreach"
    | "quote"
    | "note"
    | "sequence"
    | "notification";
  title: string;
  description: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface UseLeadActivityReturn {
  events: ActivityEvent[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLeadActivity(leadId?: string): UseLeadActivityReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref-cancelled pattern (mirrors useEnrichment / usePermitHistory):
  // each fetch takes a monotonically increasing request id; any response
  // whose id is no longer current (lead switched, refresh re-fired, or
  // component unmounted) is discarded before every setState. Prevents a
  // stale lead's activity landing after the drawer switches leads.
  const requestIdRef = useRef(0);

  const fetchActivity = useCallback(async () => {
    const currentId = ++requestIdRef.current;

    if (!leadId) {
      setEvents([]);
      setError(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(`/api/leads/${leadId}/activity`);
      if (currentId !== requestIdRef.current) return;

      if (!res.ok) {
        if (res.status === 401) {
          setEvents([]);
          setIsLoading(false);
          return;
        }
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to fetch lead activity");
      }

      const data = await res.json();
      if (currentId !== requestIdRef.current) return;
      setEvents(data.events ?? []);
    } catch (err) {
      if (currentId !== requestIdRef.current) return;
      logger.error("useLeadActivity fetch error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (currentId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [leadId]);

  useEffect(() => {
    fetchActivity();
    return () => {
      // Cancel any in-flight handling when the lead changes or the
      // component unmounts — bumping the id invalidates pending responses.
      requestIdRef.current += 1;
    };
  }, [fetchActivity]);

  return {
    events,
    isLoading,
    error,
    refresh: fetchActivity,
  };
}
