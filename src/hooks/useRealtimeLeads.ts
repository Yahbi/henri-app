"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/* ── Event types ── */

interface RealtimeLeadPayload {
  id: string;
  contractor_id: string;
  address?: string;
  zip?: string;
  trade?: string;
  status?: string;
  score?: number;
  urgency?: string;
  permit_type?: string | null;
  permit_value?: number | null;
  created_at?: string;
}

export interface RealtimeLeadEvent {
  type: "INSERT" | "UPDATE";
  lead: {
    id: string;
    address: string;
    zip: string;
    trade: string;
    status: string;
    score: number;
    permit_type: string | null;
    permit_value: number | null;
  };
}

interface RealtimeNotificationPayload {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/* ── Options ── */

export interface UseRealtimeLeadsOptions {
  contractorId?: string;
  onNewLead?: (event: RealtimeLeadEvent) => void;
  onLeadUpdate?: (event: RealtimeLeadEvent) => void;
  onNewNotification?: (notification: {
    id: string;
    type: string;
    title: string;
    body: string;
  }) => void;
  enabled?: boolean;
}

/* ── Helper to normalize a DB row into the event shape ── */

function toLeadEvent(
  type: "INSERT" | "UPDATE",
  row: RealtimeLeadPayload,
): RealtimeLeadEvent {
  return {
    type,
    lead: {
      id: row.id,
      address: row.address ?? "Unknown",
      zip: row.zip ?? "",
      trade: row.trade ?? "",
      status: row.status ?? "new",
      score: row.score ?? 0,
      permit_type: row.permit_type ?? null,
      permit_value: row.permit_value ?? null,
    },
  };
}

/* ── Hook ── */

export function useRealtimeLeads({
  contractorId,
  onNewLead,
  onLeadUpdate,
  onNewNotification,
  enabled = true,
}: UseRealtimeLeadsOptions): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Keep callback refs stable to avoid re-subscribing on every render
  const onNewLeadRef = useRef(onNewLead);
  const onLeadUpdateRef = useRef(onLeadUpdate);
  const onNewNotificationRef = useRef(onNewNotification);

  useEffect(() => {
    onNewLeadRef.current = onNewLead;
  }, [onNewLead]);

  useEffect(() => {
    onLeadUpdateRef.current = onLeadUpdate;
  }, [onLeadUpdate]);

  useEffect(() => {
    onNewNotificationRef.current = onNewNotification;
  }, [onNewNotification]);

  useEffect(() => {
    if (!enabled || !contractorId) {
      // Reset-on-disable; state drives "connected" indicator UI
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConnected(false);
      return;
    }

    const supabase = createClient();

    const channel = supabase
      .channel(`leads-rt-${contractorId}`)
      // New leads assigned to this contractor
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "leads",
          filter: `contractor_id=eq.${contractorId}`,
        },
        (payload: RealtimePostgresChangesPayload<RealtimeLeadPayload>) => {
          if (payload.new && "id" in payload.new) {
            onNewLeadRef.current?.(toLeadEvent("INSERT", payload.new));
          }
        },
      )
      // Lead status changes
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `contractor_id=eq.${contractorId}`,
        },
        (payload: RealtimePostgresChangesPayload<RealtimeLeadPayload>) => {
          if (payload.new && "id" in payload.new) {
            onLeadUpdateRef.current?.(toLeadEvent("UPDATE", payload.new));
          }
        },
      )
      // Real-time notifications for this user
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${contractorId}`,
        },
        (payload: RealtimePostgresChangesPayload<RealtimeNotificationPayload>) => {
          if (payload.new && "id" in payload.new) {
            const row = payload.new;
            onNewNotificationRef.current?.({
              id: row.id,
              type: row.type ?? "info",
              title: row.title ?? "",
              body: row.body ?? "",
            });
          }
        },
      )
      .subscribe((status: string) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [contractorId, enabled]);

  return { isConnected };
}
