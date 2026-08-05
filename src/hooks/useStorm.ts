"use client";

import { useState, useEffect, useCallback } from "react";

export interface StormAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  onset: string;
  expires: string;
  area: string;
  // Both `instruction` and `areas` are populated by some NWS feeds and
  // rendered by storm/page.tsx when present. Optional because not every
  // alert type ships them.
  instruction?: string | null;
  areas?: string | null;
}

export interface StormData {
  alerts: StormAlert[];
  territories: string[];
  fetchedAt: string;
}

interface UseStormReturn {
  alerts: StormAlert[];
  territories: string[];
  fetchedAt: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStorm(): UseStormReturn {
  const [alerts, setAlerts] = useState<StormAlert[]>([]);
  const [territories, setTerritories] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStorm = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/storm");

      if (!res.ok) {
        // Real fetch failure — surface it so the page can distinguish an
        // outage from a genuinely quiet weather week (setError, not just empty).
        setAlerts([]);
        setTerritories([]);
        setFetchedAt(null);
        setError("Couldn't load storm data.");
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setAlerts(data.alerts ?? []);
      setTerritories(data.territories ?? []);
      setFetchedAt(data.fetchedAt ?? null);
    } catch {
      // Network/parse error — surface it rather than showing "No alerts".
      setAlerts([]);
      setTerritories([]);
      setFetchedAt(null);
      setError("Couldn't load storm data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStorm();
  }, [fetchStorm]);

  return {
    alerts,
    territories,
    fetchedAt,
    isLoading,
    error,
    refresh: fetchStorm,
  };
}
