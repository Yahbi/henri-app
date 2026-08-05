"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils/cn";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function typeLabel(type: string): string {
  switch (type) {
    case "new_lead": return "New Lead";
    case "referral": return "Referral";
    case "storm": return "Storm Alert";
    case "license_expiry": return "License";
    case "territory": return "Territory";
    default: return "Update";
  }
}

export function NotificationDropdown() {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllRead,
    refresh,
  } = useNotifications(30_000); // Poll every 30 seconds

  const { user } = useUser();

  // Real-time subscription: triggers a full refresh when a new notification arrives
  const handleRealtimeNotification = useCallback(() => {
    refresh();
  }, [refresh]);

  useRealtimeNotifications({
    userId: user?.id,
    onNewNotification: handleRealtimeNotification,
    enabled: !!user?.id,
  });

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Mark individual notifications as read when dropdown opens */
  useEffect(() => {
    if (open && unreadCount > 0) {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length > 0) {
        /* Small delay so user sees the unread state briefly */
        const timer = setTimeout(() => markAsRead(unreadIds), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [open, notifications, unreadCount, markAsRead]);

  /* Close on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  /* Close on Escape — outside-click was the only dismiss path, which left
   * keyboard users stuck inside the panel once they tabbed into it. */
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
          open && "text-foreground bg-accent"
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-cta text-cta-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
          className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-border">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "px-4 py-3",
                    !n.read && "bg-primary-04"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.read ? (
                      <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-primary" aria-label="Unread" />
                    ) : (
                      <span className="mt-1.5 shrink-0 w-1.5 h-1.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          {typeLabel(n.type)}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-foreground">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[11px] text-fg-subtle mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
