"use client";

import { useState, useEffect, useCallback } from "react";

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

  const fetchActivity = useCallback(async () => {
    if (!leadId) {
      setEvents([]);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(`/api/leads/${leadId}/activity`);

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
      setEvents(data.events ?? []);
    } catch (err) {
      console.error("useLeadActivity fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return {
    events,
    isLoading,
    error,
    refresh: fetchActivity,
  };
}
