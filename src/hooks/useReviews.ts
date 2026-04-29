"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from "@/lib/logger";

export interface Review {
  id: string;
  contractor_id: string;
  reviewer_name: string;
  reviewer_email: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  trade: string | null;
  zip: string | null;
  sentiment: string | null;
  ai_response: string | null;
  response_sent: boolean;
  verified: boolean;
  source: string;
  created_at: string;
  responded_at: string | null;
}

export interface ReviewStats {
  avg: number;
  count: number;
  distribution: Record<number, number>; /* 1-5 star counts */
}

export interface SubmitReviewData {
  contractor_id: string;
  rating: number;
  title?: string;
  body?: string;
}

export interface RequestReviewData {
  lead_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  channel?: "email" | "sms" | "both";
}

interface UseReviewsReturn {
  reviews: Review[];
  stats: ReviewStats;
  isLoading: boolean;
  error: string | null;
  submitReview: (data: SubmitReviewData) => Promise<{ success: boolean; error?: string }>;
  requestReview: (data: RequestReviewData) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const defaultStats: ReviewStats = {
  avg: 0,
  count: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

export function useReviews(contractorId?: string): UseReviewsReturn {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<ReviewStats>(defaultStats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    if (!contractorId) {
      setReviews([]);
      setStats(defaultStats);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({ contractor_id: contractorId });
      const res = await fetch(`/api/reviews?${params.toString()}`);

      if (!res.ok) {
        if (res.status === 401) {
          setReviews([]);
          setStats(defaultStats);
          setIsLoading(false);
          return;
        }
        throw new Error("Failed to fetch reviews");
      }

      const data = await res.json();
      const fetchedReviews: Review[] = data.reviews ?? [];
      setReviews(fetchedReviews);

      /* Compute stats from reviews */
      if (fetchedReviews.length > 0) {
        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0;

        for (const review of fetchedReviews) {
          const rating = Math.min(5, Math.max(1, Math.round(review.rating)));
          distribution[rating] = (distribution[rating] ?? 0) + 1;
          totalRating += review.rating;
        }

        setStats({
          avg: Math.round((totalRating / fetchedReviews.length) * 10) / 10,
          count: fetchedReviews.length,
          distribution,
        });
      } else {
        setStats(defaultStats);
      }
    } catch (err) {
      logger.error("useReviews fetch error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [contractorId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const submitReview = useCallback(
    async (data: SubmitReviewData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to submit review" };
        }

        await fetchReviews();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchReviews]
  );

  const requestReview = useCallback(
    async (data: RequestReviewData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/reviews/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to request review" };
        }

        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    []
  );

  return {
    reviews,
    stats,
    isLoading,
    error,
    submitReview,
    requestReview,
    refresh: fetchReviews,
  };
}
