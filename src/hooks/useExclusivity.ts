"use client";

import { useEffect, useRef, useState } from "react";
import type { ExclusivityLeadSummary } from "@/lib/exclusivity/locks";

/**
 * Fetch exclusivity-lock summaries for a set of lead IDs.
 *
 * Each value is an `ExclusivityLeadSummary` — a lock record merged with
 * the coarse "other contractors watching" bucket from wedge contract #6.
 *
 * When the migration isn't applied or the endpoint fails, returns an
 * empty map — calling components will simply not render lock badges,
 * which is the correct fallback.
 *
 * Dedup + debounce: we key on the sorted-and-joined lead-id list so
 * rapidly re-rendering the leads panel doesn't spam the endpoint. 60s
 * stale window keeps countdown pills roughly current without
 * hammering the server.
 */
export function useExclusivity(leadIds: string[] | undefined | null) {
  const [locks, setLocks] = useState<Record<string, ExclusivityLeadSummary>>({});
  const lastKey = useRef<string | null>(null);

  // Stable serialization of the SORTED id list. The previous dependency
  // array used positional values (length + first + last id), which missed
  // membership changes in the middle of the array (e.g. a lead swapped at
  // index 3 with length/endpoints unchanged → stale locks). Sorting first
  // means reordering does NOT refetch, but any membership change does.
  const idsKey = (leadIds ?? []).filter(Boolean).slice().sort().join(",");

  useEffect(() => {
    // Wedge-critical fetch effect — reset-on-empty + async lock fetch (Phase 0a).
    // Behavior change would affect lock-badge rendering; intentionally keeping
    // setState-in-effect pattern. See CLAUDE.md "Wedge contract".
    /* eslint-disable react-hooks/set-state-in-effect */
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setLocks({});
      lastKey.current = null;
      return;
    }
    const key = idsKey;
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
          locks: Record<string, ExclusivityLeadSummary>;
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
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [idsKey]);

  return { locks };
}
