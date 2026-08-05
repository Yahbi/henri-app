"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/hooks/useUser";
import { useProfile } from "@/hooks/useProfile";
import { CheckCircle } from "lucide-react";

export default function AccountSettingsPage() {
  const { user } = useUser();
  const { profile, updateProfile } = useProfile();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    company_name: "",
    phone: "",
    bio: "",
    trade: "",
    service_area: "",
    years_experience: "",
    profile_public: false,
    twilio_tracked_number: "",
  });

  useEffect(() => {
    // Hydrate editable form once profile arrives from async fetch
    if (profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        full_name: profile.full_name ?? "",
        company_name: profile.company_name ?? "",
        phone: profile.phone ?? "",
        bio: profile.bio ?? "",
        trade: profile.trade ?? "",
        service_area: profile.service_area ?? "",
        years_experience: profile.years_experience != null ? String(profile.years_experience) : "",
        profile_public: profile.profile_public ?? false,
        twilio_tracked_number: profile.twilio_tracked_number ?? "",
      });
    }
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");

    const payload: Record<string, unknown> = {
      full_name: form.full_name,
      company_name: form.company_name,
      phone: form.phone,
      bio: form.bio,
      trade: form.trade,
      service_area: form.service_area,
      profile_public: form.profile_public,
      // Empty string clears the field server-side; the API normalizes
      // any 10-digit US number to E.164 (+1XXXXXXXXXX) before write.
      twilio_tracked_number: form.twilio_tracked_number.trim() || null,
    };

    if (form.years_experience !== "") {
      payload.years_experience = parseInt(form.years_experience, 10);
    }

    const result = await updateProfile(payload);

    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // Password-reset handler was removed entirely. Henri is Google-OAuth only
  // per CLAUDE.md; the /reset-password route no longer exists and Supabase
  // passwords aren't set for Google-provider users.

  return (
    <div className="p-8 max-w-lg space-y-8">
      <div>
        <h1 className="font-heading font-normal text-2xl text-foreground">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your profile information</p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="full-name" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Full name
          </label>
          <input
            id="full-name"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="company-name" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Company name
          </label>
          <input
            id="company-name"
            value={form.company_name}
            onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* G3 fix (2026-04-27): Twilio tracked-number input.
         * Wedge bullet #5 ("missed-call text-back within 10s") needs
         * `profiles.twilio_tracked_number` populated to know which
         * contractor a missed call routes to. Until this UI shipped,
         * the webhook had no way to find the contractor and silently
         * 404'd every call. */}
        <div>
          <label htmlFor="twilio-tracked-number" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Missed-call SMS number{" "}
            <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <input
            id="twilio-tracked-number"
            type="tel"
            placeholder="(555) 123-4567"
            value={form.twilio_tracked_number}
            onChange={(e) =>
              setForm((f) => ({ ...f, twilio_tracked_number: e.target.value }))
            }
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            When a homeowner calls this number and you don&apos;t pick up, Henri
            sends a text-back with the lead context (typically within a few
            seconds, depending on Twilio queue). Requires Henri&apos;s Twilio
            integration to be active for your account. Leave blank to
            disable. US 10-digit or +country format accepted.
          </p>
        </div>

        <div>
          <label htmlFor="trade" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Trade
          </label>
          <input
            id="trade"
            value={form.trade}
            onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="service-area" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Service area
          </label>
          <input
            id="service-area"
            value={form.service_area}
            onChange={(e) => setForm((f) => ({ ...f, service_area: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="years-experience" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Years of experience
          </label>
          <input
            id="years-experience"
            type="number"
            min="0"
            value={form.years_experience}
            onChange={(e) => setForm((f) => ({ ...f, years_experience: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Bio
          </label>
          <textarea
            id="bio"
            rows={3}
            maxLength={500}
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            {form.bio.length}/500 characters
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.profile_public}
            onClick={() => setForm((f) => ({ ...f, profile_public: !f.profile_public }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              form.profile_public ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                form.profile_public ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-sm text-foreground">Public profile</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Email
          </label>
          <input
            disabled
            value={user?.email ?? ""}
            className="w-full px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg text-muted-foreground cursor-not-allowed"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Email cannot be changed here. Contact support if needed.
          </p>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-sm font-medium bg-cta text-cta-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
      </form>

      {/* Sign-in method — Henri is Google-OAuth only. */}
      <div className="border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground mb-1">Sign-in method</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Managed by your Google account. Change password, enable 2FA, or
          revoke access from your Google security settings.
        </p>
        <a
          href="https://myaccount.google.com/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
        >
          Google security
        </a>
      </div>
    </div>
  );
}
