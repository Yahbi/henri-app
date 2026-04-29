"use client";

import { useEffect, useState } from "react";
import type { TaxResult } from "@/lib/tax/stripe-tax";

/**
 * Phase 2.4 client hook — debounced Stripe Tax preview for the
 * Estimate Builder. Wraps `/api/estimates/preview-tax`.
 *
 * Returns the most recent tax result + loading state. Re-fetches when
 * any of the inputs change, with a 250ms debounce so typing in the
 * line-item editor doesn't fire one request per keystroke.
 *
 * Falls back to a synthetic "loading" state on first call. Subsequent
 * calls keep the previous result visible while the new one loads —
 * avoids UI flicker when the user changes a line item.
 *
 * The server-side route does its own caching (1h) so even
 * un-debounced calls would be cheap; the debounce is purely UX.
 */
export interface UseStripeTaxInput {
  subtotal_cents: number;
  address: {
    line1?: string;
    city?: string;
    state?: string;
    postal_code: string;
    country: "US";
  };
  /** Optional Stripe tax code; default is general taxable. */
  product_tax_code?: string;
  /** When false, the hook is disabled (e.g. before a lead is selected). */
  enabled?: boolean;
}

export function useStripeTax(input: UseStripeTaxInput | null): {
  result: TaxResult | null;
  loading: boolean;
  error: string | null;
} {
  const [result, setResult] = useState<TaxResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable cache key — re-fetch only when inputs meaningfully change
  const key = input
    ? `${input.subtotal_cents}|${input.address.postal_code}|${input.address.state ?? ""}|${input.product_tax_code ?? ""}`
    : null;

  useEffect(() => {
    if (!input || input.enabled === false || !key) return;
    if (input.subtotal_cents <= 0) {
      // setState in an effect: strict mode flags direct calls. Defer
      // to the microtask queue so React batches outside this render
      // frame. queueMicrotask is sync-safe under StrictMode.
      queueMicrotask(() => {
        setResult(null);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
    });

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/estimates/preview-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subtotal_cents: input.subtotal_cents,
            address: input.address,
            product_tax_code: input.product_tax_code,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Tax preview failed (${res.status})`);
          setLoading(false);
          return;
        }
        const data = (await res.json()) as TaxResult;
        if (cancelled) return;
        setResult(data);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Tax preview error");
        setLoading(false);
      }
    }, 250); // debounce

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, input]);

  return { result, loading, error };
}
