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
  // A failed load used to leave prefs at the {enabled:false} default, so
  // the card asserted "auto-fire is off" when it had simply not loaded.
  // A failed save silently reverted the toggle with no message.
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/outreach/auto-fire", { credentials: "include" });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = (await res.json()) as AutoFirePrefs;
      setPrefs(body);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(next: AutoFirePrefs) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/outreach/auto-fire", {
        method: "PUT",
        credentials: "include",
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
      } else {
        // Any other non-OK used to drop the change on the floor — the
        // toggle visually reverted with nothing to explain why.
        setSaveError(`Couldn't save (server returned ${res.status}) — try again.`);
      }
    } catch {
      setSaveError("Couldn't save — check your connection and try again.");
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
            {/* Truthfulness: no scorer or cron fires outreach on lead-create
                today, and SMS delivery additionally depends on Twilio being
                provisioned. The old copy promised "the instant a new lead
                lands ... under a minute from permit ingest" — a delivery
                guarantee the backend does not make. Describe the saved
                preference honestly instead. */}
            Save a default template to send first when a new scored lead lands
            in your territory. Automatic sending turns on once SMS delivery is
            provisioned — until then, send from the template library below.
          </p>

          {prefs.migrationPending && (
            <p className="mt-2 text-[11px] text-warm">
              Feature pending migration{" "}
              <code className="font-mono">00035_outreach_auto_fire.sql</code>.
            </p>
          )}

          {loadError && (
            <div
              role="alert"
              className="mt-2 flex items-center gap-2 text-[11px] text-destructive"
            >
              <span>
                Couldn&apos;t load your auto-fire setting — the toggle below
                may not reflect your saved preference.
              </span>
              <button
                type="button"
                onClick={() => load()}
                className="font-medium underline underline-offset-2 hover:opacity-80"
              >
                Retry
              </button>
            </div>
          )}

          {saveError && (
            <p role="alert" className="mt-2 text-[11px] text-destructive">
              {saveError}
            </p>
          )}

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {/* Real <button role="switch"> — this was a <span> inside a
                <label>, so the card's primary control could not be reached
                or activated from the keyboard at all, and clicking the
                "Enabled" text (which showed a pointer cursor) did nothing
                because a <span> is not a labelable element. */}
            <div className="inline-flex items-center gap-2">
              <span id="autofire-switch-label" className="text-[12px] text-foreground">
                Enabled
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.enabled}
                aria-labelledby="autofire-switch-label"
                disabled={saving}
                onClick={() => save({ ...prefs, enabled: !prefs.enabled })}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  prefs.enabled ? "bg-primary" : "bg-muted",
                  saving && "opacity-60 cursor-not-allowed",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-background shadow transition-transform",
                    prefs.enabled && "translate-x-4",
                  )}
                />
              </button>
            </div>

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
              {/* Channel filter hides templates — say how many, never
                  silently drop rows. */}
              {effectiveTemplates.length > filteredTemplates.length && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {effectiveTemplates.length - filteredTemplates.length} on the
                  other channel
                </span>
              )}
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
