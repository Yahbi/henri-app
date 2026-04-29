"use client";

import { useState, useEffect, useCallback } from "react";
import { logger } from "@/lib/logger";

export interface Referral {
  id: string;
  referrer_id: string;
  referred_email: string;
  referred_name: string | null;
  referred_user_id: string | null;
  type: "contractor" | "homeowner";
  status: "invited" | "signed_up" | "converted";
  reward_amount: number | null;
  reward_label: string | null;
  reward_issued: boolean;
  created_at: string;
  converted_at: string | null;
}

export interface ReferralStats {
  totalReferred: number;
  converted: number;
  signedUp: number;
  invited: number;
  totalEarned: number;
  pendingRewards: number;
}

interface UseReferralsReturn {
  // Null while loading or when the referrals endpoint 401s. Consumers
  // should render a skeleton or hide the "Copy link" button until set.
  referralCode: string | null;
  referralLink: string | null;
  referrals: Referral[];
  stats: ReferralStats;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  invite: (email: string, type?: "contractor" | "homeowner") => Promise<{ success: boolean; error?: string }>;
  sendInviteEmail: (email: string, type?: "contractor" | "homeowner") => Promise<{ success: boolean; error?: string }>;
}

const defaultStats: ReferralStats = {
  totalReferred: 0,
  converted: 0,
  signedUp: 0,
  invited: 0,
  totalEarned: 0,
  pendingRewards: 0,
};

export function useReferrals(): UseReferralsReturn {
  // Null until /api/referrals resolves. Prior values ("HENRI-XXXXXX" +
  // henri.com URL) were rendered as real placeholder state for a split
  // second — looked like a valid code to the user. Null forces the
  // consumer to show a skeleton.
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stats, setStats] = useState<ReferralStats>(defaultStats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReferrals = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/referrals");
      if (!res.ok) {
        if (res.status === 401) {
          /* Not authenticated — silently return defaults */
          setIsLoading(false);
          return;
        }
        throw new Error("Failed to fetch referrals");
      }

      const data = await res.json();
      setReferralCode(data.referralCode);
      setReferralLink(data.referralLink);
      setReferrals(data.referrals ?? []);
      setStats(data.stats ?? defaultStats);
    } catch (err) {
      logger.error("useReferrals fetch error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReferrals();
  }, [fetchReferrals]);

  const invite = useCallback(
    async (
      email: string,
      type: "contractor" | "homeowner" = "contractor"
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, type }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error ?? "Failed to create referral" };
        }

        /* Refresh the list */
        await fetchReferrals();
        return { success: true };
      } catch {
        return { success: false, error: "Network error" };
      }
    },
    [fetchReferrals]
  );

  const sendInviteEmail = useCallback(
    async (
      email: string,
      type: "contractor" | "homeowner" = "contractor"
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/referrals/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, type }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error ?? "Failed to send invite" };
        }

        /* Refresh the list */
        await fetchReferrals();
        return { success: true };
      } catch {
        return { success: false, error: "Network error" };
      }
    },
    [fetchReferrals]
  );

  return {
    referralCode,
    referralLink,
    referrals,
    stats,
    isLoading,
    error,
    refresh: fetchReferrals,
    invite,
    sendInviteEmail,
  };
}
