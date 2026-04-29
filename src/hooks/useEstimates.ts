"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Shape of a row returned by GET /api/estimates.
 *
 * NB: "estimates" is an app-level abstraction. The backing table is
 * actually `quotes` (per migration 00016_marketplace_engine.sql) — the
 * API reads the same table and re-labels rows that carry at least one
 * tier as "estimates" vs ones still in the homeowner-intake pipeline.
 * This interface mirrors the `quotes` columns, NOT a separate schema.
 *
 * The previous version of this type described a fantasy `estimates`
 * table that never existed — customer_name / tax / valid_until etc.
 * were fabricated. Anyone writing new UI against the old fields got
 * runtime undefineds. The cleanup (2026-04-23) realigns the type with
 * what the API actually returns.
 */
export interface Estimate {
  id: string;
  contractor_id: string;
  homeowner_id: string | null;
  intake_id: string | null;
  lead_id: string | null;

  /* Project details (mirrors `quotes` columns) */
  trade: string;
  zip: string;
  description: string | null;
  scope_notes: string | null;

  /* Pricing — Good/Better/Best tier JSONBs. Each tier carries its own
   * { label, total, line_items: [] } shape; see the tier_good column
   * comment in migration 00016. */
  tier_good: EstimateTier | null;
  tier_better: EstimateTier | null;
  tier_best: EstimateTier | null;
  selected_tier: "good" | "better" | "best" | null;

  /* Contact (optional — set when the estimate is sent to a homeowner by
   * email). These live on the row's `contact_*` columns in `quotes`. */
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;

  /* Financing */
  financing_available: boolean;
  monthly_payment: number | null;

  /* Lifecycle */
  status:
    | "requested" | "draft" | "sent" | "viewed"
    | "accepted" | "declined" | "expired";
  requested_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;

  /**
   * App-side virtual field set by the API route when flattening the
   * three tier JSONBs. May be absent on future fetches — callers
   * should compute from `tier_${selected_tier}.total` when null.
   */
  amount?: number | null;
}

export interface EstimateTier {
  label: string;
  total: number;
  line_items: EstimateLineItem[];
}

export interface EstimateLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

/**
 * Shape the dashboard modal POSTs to `/api/estimates`. The API route
 * splits `tiers.good/better/best` into the DB's `tier_good / tier_better
 * / tier_best` columns, so the client doesn't need to match the DB
 * layout exactly — it matches the API's POST contract.
 */
export interface EstimateCreateInput {
  lead_id?: string | null;
  trade: string;
  zip: string;
  description?: string | null;
  scope_notes?: string | null;
  tiers: {
    good: EstimateTier;
    better: EstimateTier;
    best: EstimateTier;
  };
  amount: number;
  status: "draft" | "sent";
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

interface UseEstimatesReturn {
  estimates: Estimate[];
  total: number;
  isLoading: boolean;
  error: string | null;
  /**
   * Create an estimate. Accepts the API's POST contract — NOT a
   * `Partial<Estimate>`, because the POST shape diverges (tiers group,
   * amount flattened, no id/timestamps). See `EstimateCreateInput`.
   */
  createEstimate: (
    data: EstimateCreateInput,
  ) => Promise<{ success: boolean; error?: string }>;
  /**
   * Partial update. Only mutable lifecycle fields are accepted here
   * (status flips, responded_at, selected_tier). Use a stricter shape
   * rather than `Partial<Estimate>` to prevent callers from trying to
   * PATCH immutable columns like `id` or `contractor_id`.
   */
  updateEstimate: (
    id: string,
    data: Partial<
      Pick<
        Estimate,
        | "status"
        | "selected_tier"
        | "responded_at"
        | "scope_notes"
        | "description"
      >
    >,
  ) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useEstimates(): UseEstimatesReturn {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEstimates = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/estimates");

      if (!res.ok) {
        setEstimates([]);
        setTotal(0);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      const fetched: Estimate[] = data.estimates ?? [];
      setEstimates(fetched);
      setTotal(data.total ?? fetched.length);
    } catch {
      // API not available — return clean defaults
      setEstimates([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const createEstimate = useCallback(
    async (
      data: EstimateCreateInput,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/estimates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to create estimate" };
        }

        await fetchEstimates();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchEstimates]
  );

  const updateEstimate = useCallback(
    async (
      id: string,
      data: Partial<
        Pick<
          Estimate,
          | "status"
          | "selected_tier"
          | "responded_at"
          | "scope_notes"
          | "description"
        >
      >,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/estimates/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to update estimate" };
        }

        await fetchEstimates();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchEstimates]
  );

  return {
    estimates,
    total,
    isLoading,
    error,
    createEstimate,
    updateEstimate,
    refresh: fetchEstimates,
  };
}
