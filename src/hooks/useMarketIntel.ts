"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MarketIntelTrade {
  trade: string;
  count: number;
  total_value: number;
}

export interface MarketIntelApplicant {
  name: string;
  count: number;
  total_value: number;
}

export interface MarketIntel {
  zip: string;
  state: string | null;
  as_of: string;
  permit_count_90d: number;
  total_value_90d: number;
  avg_value_90d: number;
  permit_count_mom_delta_pct: number | null;
  top_trades: MarketIntelTrade[];
  top_applicants: MarketIntelApplicant[];
  trending_up: MarketIntelTrade[];
  trending_down: MarketIntelTrade[];
}

export function useMarketIntel(zip: string | null | undefined) {
  const [intel, setIntel] = useState<MarketIntel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  // A real fetch failure must be distinguishable from a genuinely empty ZIP —
  // otherwise the panel mislabels an outage as "no permit activity".
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);
  /** Bumped by `refresh()` so the effect re-runs for the SAME zip. Without
   *  it the panel's "try again" path was inert: re-submitting an
   *  identical ZIP set identical state, React bailed out, and the
   *  lastKey short-circuit blocked a refetch anyway. */
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!zip) {
      setIntel(null);
      setError(null);
      lastKey.current = null;
      return;
    }
    const clean = String(zip).slice(0, 5);
    if (!/^\d{5}$/.test(clean)) return;
    if (lastKey.current === clean && reloadNonce === 0) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/market-intel/${clean}`, { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) {
            // Drop the previous ZIP's data — otherwise the panel showed
            // the error banner for the new ZIP AND the old ZIP's metrics
            // side by side.
            setIntel(null);
            setError("Couldn't load market intelligence.");
          }
          return;
        }
        const body = (await res.json()) as {
          intel: MarketIntel | null;
          migrationPending?: boolean;
        };
        if (!cancelled) {
          lastKey.current = clean;
          setIntel(body.intel);
          setMigrationPending(!!body.migrationPending);
        }
      } catch {
        if (!cancelled) {
          setIntel(null);
          setError("Couldn't load market intelligence.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [zip, reloadNonce]);

  /** Re-run the fetch for the current ZIP (retry after an error). */
  const refresh = useCallback(() => {
    lastKey.current = null;
    setReloadNonce((n) => n + 1);
  }, []);

  return { intel, isLoading, migrationPending, error, refresh };
}
