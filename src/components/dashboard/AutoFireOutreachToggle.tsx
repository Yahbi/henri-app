"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Phase 0a wedge #6 — speed-to-lead auto-fire toggle.
 *
 * Shown on the Outreach tab. When on, the scorer's lead-create hook
 * fires the contractor's chosen template within ~60s of a new permit
 * appearing in their territory — that's the 10x conversion lever
 * contractors can't hit manually while they're on a ladder.
 *
 * Graceful-degrades when migration 00035 isn't applied — toggle
 * disables itself + shows a one-line explanation.
 */

interface AutoFirePrefs {
  enabled: boolean;
  template_id: string | null;
  channel: "email" | "sms";
  migrationPending?: boolean;
}

interface TemplateOption {
  id: string;
  name: string;
  channel: string;
  trade?: string | null;
}

export function AutoFireOutreachToggle({
  templates,
}: {
  /** Optional: parent can pass a pre-fetched template list. When not
   *  provided, the component fetches directly from Supabase. */
  templates?: TemplateOption[];
} = {}) {
  const [fallbackTemplates, setFallbackTemplates] = useState<TemplateOption[]>([]);
  const effectiveTemplates = templates ?? fallbackTemplates;

  useEffect(() => {
    if (templates) return; // parent supplied them
    let cancelled = false;
    (async () => {
      try {
        // Reuse the outreach-library endpoint — it returns trade + channel
        // which is exactly what the picker needs. When no library exists
        // yet, the list will be empty; the user can still toggle off.
        const res = await fetch("/api/outreach/library");
        if (!res.ok) return;
        const body = (await res.json()) as { templates: TemplateOption[] };
        if (!cancelled) setFallbackTemplates(body.templates ?? []);
      } catch {
        /* leave empty */
      }
    })();
    return () => { cancelled = true; };
  }, [templates]);

  const [prefs, setPrefs] = useState<AutoFirePrefs>({
    enabled: false,
    template_id: null,
    channel: "email",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/auto-fire", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as AutoFirePrefs;
      setPrefs(body);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(next: AutoFirePrefs) {
    setSaving(true);
    try {
      const res = await fetch("/api/outreach/auto-fire", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled,
          template_id: next.template_id,
          channel: next.channel,
        }),
      });
      if (res.ok) {
        setPrefs(next);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      } else if (res.status === 503) {
        setPrefs({ ...next, migrationPending: true });
      }
    } finally {
      setSaving(false);
    }
  }

  const filteredTemplates = effectiveTemplates.filter((t) => t.channel === prefs.channel);

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-9 w-9 rounded-lg bg-primary-10 flex items-center justify-center">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              Auto-fire first outreach
            </h3>
            {justSaved && (
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Send your chosen template automatically the instant a new scored
            lead lands in your territory. Typical delivery: under a minute
            from permit ingest.
          </p>

          {prefs.migrationPending && (
            <p className="mt-2 text-[11px] text-warm">
              Feature pending migration{" "}
              <code className="font-mono">00035_outreach_auto_fire.sql</code>.
            </p>
          )}

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <span className="text-[12px] text-foreground">Enabled</span>
              <span
                role="switch"
                aria-checked={prefs.enabled}
                onClick={() => !saving && save({ ...prefs, enabled: !prefs.enabled })}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
                  prefs.enabled ? "bg-primary" : "bg-muted",
                  saving && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-background shadow transition-transform",
                    prefs.enabled && "translate-x-4",
                  )}
                />
              </span>
            </label>

            <div className="h-4 w-px bg-border" />

            <label className="inline-flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Channel
              </span>
              <select
                value={prefs.channel}
                onChange={(e) =>
                  save({
                    ...prefs,
                    channel: e.target.value as "email" | "sms",
                    // Clear template when channel flips — different channels
                    // usually use different templates.
                    template_id: null,
                  })
                }
                disabled={saving}
                className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Template
              </span>
              <select
                value={prefs.template_id ?? ""}
                onChange={(e) =>
                  save({
                    ...prefs,
                    template_id: e.target.value || null,
                  })
                }
                disabled={saving || filteredTemplates.length === 0}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              >
                <option value="">
                  {filteredTemplates.length === 0
                    ? "No templates for this channel"
                    : "\u2014 pick a template \u2014"}
                </option>
                {filteredTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.trade ? ` (${t.trade})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {prefs.enabled && !prefs.template_id && (
            <p className="mt-2 text-[11px] text-warm">
              Auto-fire is on but no template selected — nothing will send.
              Pick a template above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
