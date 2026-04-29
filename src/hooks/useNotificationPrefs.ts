"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from "@/lib/logger";
import type { NotificationPrefs } from "@/types/profile";

interface UseNotificationPrefsReturn {
  prefs: NotificationPrefs | null;
  isLoading: boolean;
  error: string | null;
  updatePrefs: (data: Partial<NotificationPrefs>) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useNotificationPrefs(): UseNotificationPrefsReturn {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/profile/notifications");

      if (!res.ok) {
        if (res.status === 401) {
          setPrefs(null);
          setIsLoading(false);
          return;
        }
        throw new Error("Failed to fetch notification preferences");
      }

      const data = await res.json();
      setPrefs(data.prefs ?? null);
    } catch (err) {
      logger.error("useNotificationPrefs fetch error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const updatePrefs = useCallback(
    async (data: Partial<NotificationPrefs>): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/profile/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to update preferences" };
        }

        setPrefs(result.prefs ?? null);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    []
  );

  return {
    prefs,
    isLoading,
    error,
    updatePrefs,
    refresh: fetchPrefs,
  };
}
