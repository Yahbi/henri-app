"use client";

import { useEffect, useState } from "react";

/**
 * Live Founder-tier seat counter. Reads /api/founder-seats and
 * renders "X / 100 seats remaining" + a thin progress bar.
 *
 * Defensive rendering:
 *   - skeleton while loading so the page doesn't pop in
 *   - graceful fallback to "100 Founder seats — first come, first
 *     served" when the count isn't available (API down, RLS
 *     surprise, table missing). We never claim a number we can't
 *     verify (CLAUDE.md truthfulness rule).
 *   - cancellation-safe useEffect — matches the ref-cancelled
 *     pattern used by useEnrichment / useExclusivity.
 */

type SeatsPayload = {
  total: number;
  taken: number | null;
  remaining: number | null;
  error?: string;
};

export function FounderSeats({ className = "" }: { className?: string }) {
  const [data, setData] = useState<SeatsPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/founder-seats", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as SeatsPayload;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) {
          // Fallback shape — still truthful (we know the cap is 100,
          // we just don't know the live count this render).
          setData({ total: 100, taken: null, remaining: null, error: "fetch_failed" });
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  // Loading: subtle skeleton, no layout jump.
  if (!loaded) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`} role="status" aria-live="polite">
        <span className="inline-block h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Fallback (no live count available): just state the cap.
  if (!data || data.taken == null || data.remaining == null) {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        100 Founder-tier seats — price locked at $149/mo for life.
      </p>
    );
  }

  const pctTaken = Math.min(100, Math.round((data.taken / data.total) * 100));
  const isFull = data.remaining === 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} role="status" aria-live="polite">
      <p className="text-xs font-medium text-muted-foreground">
        {isFull ? (
          <>
            <span className="text-foreground">All {data.total} Founder-tier seats taken.</span>{" "}
            New signups join the Starter waitlist.
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">
              {data.remaining} of {data.total}
            </span>{" "}
            Founder-tier seats remaining — price locked at $149/mo for life.
          </>
        )}
      </p>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={data.taken}
        aria-valuemin={0}
        aria-valuemax={data.total}
        aria-label={`${data.taken} of ${data.total} Founder seats taken`}
      >
        <div
          className="h-full bg-primary transition-[width] duration-700"
          style={{ width: `${pctTaken}%` }}
        />
      </div>
    </div>
  );
}
