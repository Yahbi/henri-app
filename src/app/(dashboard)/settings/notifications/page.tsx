"use client";

import { useState } from "react";
import { useNotificationPrefs } from "@/hooks/useNotificationPrefs";
import { CheckCircle } from "lucide-react";
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function NotificationsPage() {
  const { prefs, isLoading, updatePrefs } = useNotificationPrefs();
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

  return (
    <div className="p-8 max-w-lg space-y-6">
      <div>
        <h1 className="font-heading font-normal text-2xl text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose how Henri alerts you</p>
      </div>

      <div className="space-y-0 border border-border rounded-xl overflow-hidden divide-y divide-border">
        {PREF_LABELS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between px-4 py-4">
            <div className="flex-1 pr-8">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <Toggle checked={getValue(key)} onChange={() => toggle(key)} />
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(localOverrides).length === 0}
          className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
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
