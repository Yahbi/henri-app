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
/**
 * Most leads whose locks are fetched per mount.
 *
 * The badge is a visual affordance on a virtualized list, so this is bounded
 * by what the UI can show rather than by how many leads exist — a god-mode
 * session carries 11,395. At CHUNK=100 that is 5 requests per mount.
 */
const MAX_IDS = 500;

export function useExclusivity(leadIds: string[] | undefined | null) {
  const [locks, setLocks] = useState<Record<string, ExclusivityLeadSummary>>({});
  const lastKey = useRef<string | null>(null);

  // Stable serialization of the id list, capped then sorted.
  //
  // Sorting: an earlier dependency array used positional values (length +
  // first + last id), which missed membership changes in the middle of the
  // array (a lead swapped at index 3 with length and endpoints unchanged →
  // stale locks). Sorting means reordering does NOT refetch while any real
  // membership change does.
  //
  // Order matters twice over. Capping first is what makes the key stable:
  // `useLeads` pages results in, so the array grows on every page and an
  // uncapped key changed each time — the effect refetched the whole set per
  // page, which is how a single dashboard load fired 110 requests and then
  // exhausted the browser's connection pool with ERR_INSUFFICIENT_RESOURCES.
  // Slicing in ARRAY order (not sorted order) means the first MAX_IDS entries
  // stop changing once they have loaded, so the key settles and refetching
  // stops. Sorting after the slice still makes reordering a no-op while any
  // real membership change in that window is picked up.
  const idsKey = (leadIds ?? []).filter(Boolean).slice(0, MAX_IDS).sort().join(",");

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
        // Request in chunks. The ids travel in the QUERY STRING, so the
        // binding limit is URL BYTES, not row count — the previous
        // `ids.slice(0, 500)` confused the two. A UUID plus its `%2C`
        // separator is ~39 characters, so 500 ids is a ~19KB request line and
        // even 204 ids measured 8,003 characters, which the dev server
        // rejected with 431 (Request Header Fields Too Large).
        //
        // The failure was invisible in the worst way: `!res.ok` clears the
        // lock map, so exclusivity badges simply never rendered for any
        // contractor holding more than ~200 leads, and nothing logged. That
        // is the wedge's own signal silently absent on exactly the accounts
        // that matter most.
        //
        // 100 keeps each request near 3.9KB — comfortably inside the limit
        // with room for cookies, which also count toward the header budget.
        // Same reasoning as IN_CHUNK in api/cron/territory-backfill.
        const CHUNK = 100;
        // `ids` is already capped at MAX_IDS by idsKey above.
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

        const responses = await Promise.all(
          chunks.map((chunk) =>
            fetch(`/api/exclusivity?lead_ids=${encodeURIComponent(chunk.join(","))}`, {
              credentials: "include",
            }),
          ),
        );

        // Partial success is still worth rendering: a badge that is present
        // is accurate, and a missing one degrades to "no lock shown", which
        // is what the whole map used to do for every lead.
        const merged: Record<string, ExclusivityLeadSummary> = {};
        for (const res of responses) {
          if (!res.ok) continue;
          const body = (await res.json()) as {
            locks?: Record<string, ExclusivityLeadSummary>;
          };
          Object.assign(merged, body.locks ?? {});
        }

        if (!cancelled) {
          lastKey.current = key;
          setLocks(merged);
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
