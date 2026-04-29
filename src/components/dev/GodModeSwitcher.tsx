"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Dev-only floating widget for flipping between contractor and homeowner
 * views without logging out. Renders nothing in production builds (the parent
 * gates rendering on NODE_ENV), and renders nothing if no user is signed in.
 */
export function GodModeSwitcher() {
  const [role, setRole] = useState<"contractor" | "homeowner" | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Gate the widget on the server-side allowlist. If the user isn't
      // allowed (or isn't signed in), the endpoint returns { allowed: false }
      // and we render nothing.
      try {
        const res = await fetch("/api/dev/switch-role");
        if (!res.ok) return;
        const { allowed } = (await res.json()) as { allowed?: boolean };
        if (!allowed || cancelled) return;
      } catch {
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      setEmail(user.email ?? null);
      setRole(
        profile?.role === "homeowner" || profile?.role === "contractor"
          ? profile.role
          : null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !role) return null;

  async function switchTo(target: "contractor" | "homeowner") {
    if (target === role || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/dev/switch-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: target }),
      });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { redirect?: string };
      window.location.href = data.redirect ?? "/";
    } catch {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(20, 20, 20, 0.92)",
        color: "#F5F1EA",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        border: "1px solid color-mix(in srgb, var(--primary) 50%, transparent)",
      }}
      aria-label="Dev role switcher"
    >
      <span style={{ opacity: 0.7 }}>DEV</span>
      <span style={{ fontWeight: 600 }}>{email}</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <button
        type="button"
        onClick={() => switchTo("contractor")}
        disabled={loading}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.15)",
          background: role === "contractor" ? "var(--primary)" : "transparent",
          color: role === "contractor" ? "#fff" : "#F5F1EA",
          cursor: loading ? "progress" : "pointer",
          fontWeight: 600,
          opacity: loading && role !== "contractor" ? 0.5 : 1,
        }}
      >
        Contractor
      </button>
      <button
        type="button"
        onClick={() => switchTo("homeowner")}
        disabled={loading}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.15)",
          background: role === "homeowner" ? "var(--primary)" : "transparent",
          color: role === "homeowner" ? "#fff" : "#F5F1EA",
          cursor: loading ? "progress" : "pointer",
          fontWeight: 600,
          opacity: loading && role !== "homeowner" ? 0.5 : 1,
        }}
      >
        Homeowner
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide"
        style={{
          marginLeft: 4,
          padding: "2px 6px",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
