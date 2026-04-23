"use client";

import { useState, useEffect, useCallback } from "react";
import type { ContractorProfile, ContractorProfileUpdate } from "@/types/profile";

interface UseProfileReturn {
  profile: ContractorProfile | null;
  isLoading: boolean;
  error: string | null;
  updateProfile: (data: Partial<ContractorProfileUpdate>) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useProfile(): UseProfileReturn {
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/profile");

      if (!res.ok) {
        if (res.status === 401) {
          setProfile(null);
          setIsLoading(false);
          return;
        }
        throw new Error("Failed to fetch profile");
      }

      const data = await res.json();
      setProfile(data.profile ?? null);
    } catch (err) {
      console.error("useProfile fetch error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(
    async (data: Partial<ContractorProfileUpdate>): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to update profile" };
        }

        setProfile(result.profile ?? null);
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
    profile,
    isLoading,
    error,
    updateProfile,
    refresh: fetchProfile,
  };
}
