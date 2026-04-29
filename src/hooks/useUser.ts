"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type { User, Session, AuthChangeEvent } from "@supabase/supabase-js";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  trade: string | null;
  plan: string | null;
  onboarding_completed: boolean;
  points_balance?: number;
  tier?: string;
  total_jobs_won?: number;
  avg_rating?: number;
  /** Stripe trial end timestamp (ISO). Populated by the checkout webhook
   * when subscription_data.trial_period_days is set. Null outside trial. */
  trial_ends_at?: string | null;
  /** License expiration date (ISO or YYYY-MM-DD). If in the past, the
   * scoring cron pauses generating new leads for this contractor. */
  licensed_until?: string | null;
  /** Licensing state filed from /api/licenses/verify daily cron. */
  license_state?: string | null;
  /** Stripe customer ID — present after first checkout. Used to route
   * plan upgrades through change-plan instead of creating a new subscription. */
  stripe_customer_id?: string | null;
}

interface UseUserReturn {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export function useUser(): UseUserReturn {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name, phone, trade, plan, onboarding_completed, points_balance, tier, total_jobs_won, avg_rating, trial_ends_at, licensed_until, license_state")
      .eq("id", userId)
      .single();
    if (data) setProfile(data as UserProfile);
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  useEffect(() => {
    // Defensive: wrap the whole init flow + the auth-change handler in
    // try/finally so a profile-fetch error (e.g. missing column in live DB)
    // can't leave `loading` stuck on `true` and freeze the page on a skeleton.
    // Historical footgun — see plan gap G11 + G12.
    const getUser = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        setUser(authUser);
        if (authUser) await fetchProfile(authUser.id);
      } catch (err) {
        logger.error("useUser init failed", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, session: Session | null) => {
        try {
          const authUser = session?.user ?? null;
          setUser(authUser);
          if (authUser) {
            await fetchProfile(authUser.id);
          } else {
            setProfile(null);
          }
        } catch (err) {
          logger.error("useUser auth-change handler failed", { error: err instanceof Error ? err.message : String(err) });
        } finally {
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

  return { user, profile, loading, signOut, refreshProfile };
}
