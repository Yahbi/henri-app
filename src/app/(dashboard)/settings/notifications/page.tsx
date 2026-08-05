"use client";

import { useState } from "react";
import { useNotificationPrefs } from "@/hooks/useNotificationPrefs";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import type { NotificationPrefs } from "@/types/profile";

const PREF_LABELS: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "email_new_lead", label: "New lead email", description: "Email with full lead details for each new permit match" },
  { key: "sms_new_lead", label: "New lead SMS", description: "Instant text when a new lead arrives in your territory" },
  { key: "email_lead_update", label: "Lead update email", description: "Email when a lead's status or details change" },
  { key: "sms_lead_update", label: "Lead update SMS", description: "Text alert when a lead's status changes" },
  { key: "email_weekly_digest", label: "Weekly digest", description: "Summary of leads, wins, and territory activity" },
  { key: "email_daily_digest", label: "Daily digest", description: "Daily summary of new leads and activity" },
  { key: "sms_storm_alerts", label: "Storm alerts SMS", description: "Text alerts for severe weather events in your territories" },
  { key: "email_review_received", label: "Review received", description: "Email when a customer leaves you a review" },
  { key: "email_quote_request", label: "Quote request email", description: "Email when a homeowner requests a quote" },
  { key: "sms_quote_request", label: "Quote request SMS", description: "Text alert for incoming quote requests" },
  { key: "email_payment_alerts", label: "Payment alerts", description: "Email receipt for every billing charge" },
];

/* The local Toggle re-implementation that used to live here was deleted
 * 2026-08-04. It duplicated `@/components/ui/toggle` pixel-for-pixel but
 * accepted only `checked` + `onChange` with no props spread, so it was
 * structurally incapable of forwarding an `aria-label` — all 11 switches
 * on this page computed an empty accessible name (WCAG 2.2 §4.1.2, Level
 * A) and any developer "fixing" it at the call site would have seen the
 * prop silently dropped. It also omitted `type="button"`. The shared
 * primitive handles all of that. */

export default function NotificationsPage() {
  const {
    prefs,
    isLoading,
    updatePrefs,
    // Both were declared and returned by the hook but never destructured
    // here, so a 500 from /api/profile/notifications (or an expired
    // session, which the hook handles by clearing prefs WITHOUT setting
    // error) rendered all 11 switches "off" with no banner and no retry —
    // a backend failure indistinguishable from "I turned everything off".
    error: loadError,
    refresh,
  } = useNotificationPrefs();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  /* Local overrides applied on top of fetched prefs, batched on save */
  const [localOverrides, setLocalOverrides] = useState<Partial<NotificationPrefs>>({});

  function toggle(key: keyof NotificationPrefs) {
    setLocalOverrides((prev) => {
      const current = key in prev ? prev[key] : prefs?.[key] ?? false;
      return { ...prev, [key]: !current };
    });
  }

  function getValue(key: keyof NotificationPrefs): boolean {
    if (key in localOverrides) return localOverrides[key] as boolean;
    return prefs?.[key] ?? false;
  }

  async function handleSave() {
    if (Object.keys(localOverrides).length === 0) return;
    setSaving(true);
    setError("");

    const result = await updatePrefs(localOverrides);

    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setLocalOverrides({});
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-lg">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-bg-subtle rounded w-40" />
          <div className="h-4 bg-bg-subtle rounded w-64" />
          <div className="space-y-3 mt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-bg-subtle rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Load settled but produced no prefs — covers both the thrown-error
  // path and the silent 401 path. Never fall through to the toggle list,
  // which would render every switch off and look like real state.
  if (!prefs) {
    return (
      <div className="p-8 max-w-lg space-y-6">
        <div>
          <h1 className="font-heading font-normal text-2xl text-foreground">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">Choose how Henri alerts you</p>
        </div>
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm"
        >
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load your notification settings
          </p>
          <p className="mt-1 text-muted-foreground">
            These are <strong className="text-foreground">not</strong> your saved
            preferences — nothing has been turned off.
            {loadError ? ` ${loadError}` : " Your session may have expired."}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg space-y-6">
      <div>
        <h1 className="font-heading font-normal text-2xl text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose how Henri alerts you</p>
      </div>

      <fieldset className="space-y-0 border border-border rounded-xl overflow-hidden divide-y divide-border">
        <legend className="sr-only">Notification preferences</legend>
        {PREF_LABELS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between px-4 py-4">
            <div className="flex-1 pr-8">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <Toggle
              aria-label={label}
              checked={getValue(key)}
              onChange={() => toggle(key)}
            />
          </div>
        ))}
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(localOverrides).length === 0}
          className="px-5 py-2 text-sm font-medium bg-cta text-cta-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save preferences"}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-green-600">
            <CheckCircle className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
