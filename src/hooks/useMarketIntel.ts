"use client";

import { useEffect, useRef, useState } from "react";

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
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!zip) {
      setIntel(null);
      lastKey.current = null;
      return;
    }
    const clean = String(zip).slice(0, 5);
    if (!/^\d{5}$/.test(clean)) return;
    if (lastKey.current === clean) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/market-intel/${clean}`, { credentials: "include" });
        if (!res.ok) return;
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
        if (!cancelled) setIntel(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [zip]);

  return { intel, isLoading, migrationPending };
}
