"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_CAPACITY_PREFS, type CapacityPrefs } from "@/lib/capacity/types";

interface UseCapacityPrefsReturn {
  prefs: CapacityPrefs;
  isLoading: boolean;
  migrationPending: boolean;
  save: (next: CapacityPrefs) => Promise<{ ok: boolean; error?: string }>;
  clear: () => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

/**
 * Contractor-scoped capacity preferences. Shared by the Settings page
 * (editing) and the Leads filter bar (applying). Cached in component
 * state; a single fetch per mount. Callers that mutate propagate the
 * change optimistically.
 */
export function useCapacityPrefs(): UseCapacityPrefsReturn {
  const [prefs, setPrefs] = useState<CapacityPrefs>(EMPTY_CAPACITY_PREFS);
  const [isLoading, setIsLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/capacity", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        prefs: CapacityPrefs;
        migrationPending?: boolean;
      };
      setPrefs(body.prefs ?? EMPTY_CAPACITY_PREFS);
      setMigrationPending(!!body.migrationPending);
    } catch {
      // Swallow; defaults already in state.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: CapacityPrefs) => {
      try {
        const res = await fetch("/api/capacity", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          prefs?: CapacityPrefs;
          error?: string;
          migrationPending?: boolean;
        };
        if (res.status === 503 && body.migrationPending) {
          setMigrationPending(true);
          return { ok: false, error: body.error ?? "Feature pending migration" };
        }
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error ?? `HTTP ${res.status}` };
        }
        setPrefs(body.prefs ?? next);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
      }
    },
    [],
  );

  const clear = useCallback(() => save(EMPTY_CAPACITY_PREFS), [save]);

  return { prefs, isLoading, migrationPending, save, clear, refresh };
}
