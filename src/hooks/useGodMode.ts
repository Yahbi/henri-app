"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Returns whether the currently-signed-in user is on the god-mode allowlist.
 *
 * God-mode users see all their leads (up to 5,000 on the dashboard, 25,000
 * on the map) without plan-based caps. Non-allowlisted subscribers get the
 * default caps (500 / 2000) that will eventually gate by plan tier.
 *
 * Backed by `/api/dev/is-god-mode` which returns `{ godMode: boolean }`.
 * Cached for 5 minutes — the answer doesn't change between requests unless
 * the user signs in as someone else.
 */
export function useGodMode(): boolean {
  const { data } = useQuery({
    queryKey: ["god-mode"],
    queryFn: async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/dev/is-god-mode");
        if (!res.ok) return false;
        const body = (await res.json()) as { godMode?: boolean };
        return !!body.godMode;
      } catch {
        return false;
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return data ?? false;
}
