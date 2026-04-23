"use client";

import { useEffect, useRef, useState } from "react";
import type { ExclusivityLockSummary } from "@/lib/exclusivity/locks";

/**
 * Fetch exclusivity-lock summaries for a set of lead IDs.
 *
 * Returns a map keyed by lead_id. When the migration isn't applied or
 * the endpoint fails, returns an empty map — calling components will
 * simply not render lock badges, which is the correct fallback.
 *
 * Dedup + debounce: we key on the sorted-and-joined lead-id list so
 * rapidly re-rendering the leads panel doesn't spam the endpoint. 60s
 * stale window keeps countdown pills roughly current without
 * hammering the server.
 */
export function useExclusivity(leadIds: string[] | undefined | null) {
  const [locks, setLocks] = useState<Record<string, ExclusivityLockSummary>>({});
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const ids = (leadIds ?? []).filter(Boolean);
    if (ids.length === 0) {
      setLocks({});
      lastKey.current = null;
      return;
    }
    const key = ids.slice().sort().join(",");
    if (key === lastKey.current) return;

    let cancelled = false;
    (async () => {
      try {
        // Cap URL length — PostgREST-style .in() calls in our dashboard
        // cap around 500 IDs, and this endpoint enforces the same.
        const capped = ids.slice(0, 500).join(",");
        const res = await fetch(
          `/api/exclusivity?lead_ids=${encodeURIComponent(capped)}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) setLocks({});
          return;
        }
        const body = (await res.json()) as {
          locks: Record<string, ExclusivityLockSummary>;
        };
        if (!cancelled) {
          lastKey.current = key;
          setLocks(body.locks ?? {});
        }
      } catch {
        if (!cancelled) setLocks({});
      }
    })();
    return () => { cancelled = true; };
  }, [leadIds?.length, leadIds?.[0], leadIds?.[leadIds.length - 1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return { locks };
}
