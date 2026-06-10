"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  markAsRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useNotifications(pollIntervalMs = 30_000): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref-cancelled pattern (mirrors useEnrichment): a polling fetch that is
  // in flight when the component unmounts must not setState when its
  // response lands. Set true in the effect cleanup; checked before every
  // setState below.
  const cancelledRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (cancelledRef.current || !res.ok) return;

      const data = await res.json();
      if (cancelledRef.current) return;
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* Silent fail on polling */
    } finally {
      if (!cancelledRef.current) setIsLoading(false);
    }
  }, []);

  /* Initial fetch + polling */
  useEffect(() => {
    cancelledRef.current = false;
    fetchNotifications();

    if (pollIntervalMs > 0) {
      intervalRef.current = setInterval(fetchNotifications, pollIntervalMs);
    }

    return () => {
      // Cancel in-flight handling AND stop the poll loop on unmount.
      cancelledRef.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchNotifications, pollIntervalMs]);

  const markAsRead = useCallback(
    async (ids: string[]) => {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (cancelledRef.current) return;

        /* Optimistic update */
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - ids.length));
      } catch {
        /* Retry on next poll */
      }
    },
    []
  );

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (cancelledRef.current) return;

      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      /* Retry on next poll */
    }
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllRead,
    refresh: fetchNotifications,
  };
}
