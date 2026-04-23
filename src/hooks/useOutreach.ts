"use client";

import { useState, useEffect, useCallback } from "react";

export interface OutreachStats {
  total_sent: number;
  open_rate: number;
  reply_rate: number;
}

export interface OutreachItem {
  id: string;
  lead_id: string;
  address: string;
  channel: string;
  subject: string | null;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
}

export interface FollowUpSequence {
  id: string;
  name: string;
  trigger_status: string;
  steps: unknown[];
  active: boolean;
  created_at: string;
}

export interface SendOutreachData {
  lead_id: string;
  channel: "sms" | "email";
  template_name?: string;
  message: string;
}

interface UseOutreachReturn {
  stats: OutreachStats;
  recent: OutreachItem[];
  sequences: FollowUpSequence[];
  isLoading: boolean;
  error: string | null;
  sendOutreach: (data: SendOutreachData) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const defaultStats: OutreachStats = {
  total_sent: 0,
  open_rate: 0,
  reply_rate: 0,
};

export function useOutreach(): UseOutreachReturn {
  const [stats, setStats] = useState<OutreachStats>(defaultStats);
  const [recent, setRecent] = useState<OutreachItem[]>([]);
  const [sequences, setSequences] = useState<FollowUpSequence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOutreach = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/outreach");

      if (!res.ok) {
        setStats(defaultStats);
        setRecent([]);
        setSequences([]);
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setStats(data.stats ?? defaultStats);
      setRecent(data.recent ?? []);
      setSequences(data.sequences ?? []);
    } catch {
      // API not available — return clean defaults
      setStats(defaultStats);
      setRecent([]);
      setSequences([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOutreach();
  }, [fetchOutreach]);

  const sendOutreach = useCallback(
    async (data: SendOutreachData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (!res.ok) {
          return { success: false, error: result.error ?? "Failed to send outreach" };
        }

        await fetchOutreach();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchOutreach]
  );

  return {
    stats,
    recent,
    sequences,
    isLoading,
    error,
    sendOutreach,
    refresh: fetchOutreach,
  };
}
