"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/* ── Types ── */

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface RealtimeNotification {
  id: string;
  type: string;
  title: string;
  body: string;
}

export interface UseRealtimeNotificationsOptions {
  userId?: string;
  onNewNotification?: (notification: RealtimeNotification) => void;
  enabled?: boolean;
}

/* ── Hook ── */

export function useRealtimeNotifications({
  userId,
  onNewNotification,
  enabled = true,
}: UseRealtimeNotificationsOptions): {
  unreadCount: number;
  isConnected: boolean;
  resetCount: () => void;
} {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Keep callback ref stable
  const callbackRef = useRef(onNewNotification);
  useEffect(() => {
    callbackRef.current = onNewNotification;
  }, [onNewNotification]);

  const resetCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      // Reset-on-disable; state drives "connected" indicator UI
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConnected(false);
      return;
    }

    const supabase = createClient();

    const channel = supabase
      .channel(`notifications-rt-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<NotificationRow>) => {
          if (payload.new && "id" in payload.new) {
            const row = payload.new;

            // Only count unread notifications
            if (!row.read) {
              setUnreadCount((prev) => prev + 1);
            }

            callbackRef.current?.({
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
  }, [userId, enabled]);

  return { unreadCount, isConnected, resetCount };
}
