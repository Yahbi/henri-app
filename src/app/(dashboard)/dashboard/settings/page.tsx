"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { LicensingSection } from "@/components/settings/LicensingSection";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import {
  Building2,
  Mail,
  Phone,
  Calendar,
  MapPin,
  CreditCard,
  Bell,
  AlertTriangle,
  ChevronRight,
  LogOut,
  KeyRound,
  ExternalLink,
  LifeBuoy,
  PlayCircle,
} from "lucide-react";

import { PLAN_INFO, PLAN_ZIP_LIMITS } from "@/lib/plans/constants";

/* Toggle switch now lives in `@/components/ui/toggle` — promoted from a
 * local re-implementation here (2026-06-09) per the primitives rule.
 * Same visuals + role="switch" semantics. */

/* ─── Section wrapper ─── */
function Section({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-6 ${className ?? ""}`}>
      {children}
    </Card>
  );
}

/* ─── Settings Page ─── */
export default function SettingsPage() {
  const { user, profile, loading, signOut } = useUser();
  const router = useRouter();
  const { addToast } = useToast();

  /* Notification preferences — persisted via /api/profile/notifications */
  const [notifPrefs, setNotifPrefs] = useState({
    sms_new_leads: true,
    email_new_leads: true,
    weekly_report: true,
    storm_alerts: false,
  });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  const [signingOut, setSigningOut] = useState(false);

  /* Load saved notification prefs on mount */
  useEffect(() => {
    fetch("/api/profile/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setNotifPrefs({
            sms_new_leads: data.sms_new_lead ?? true,
            email_new_leads: data.email_new_lead ?? true,
            weekly_report: data.email_weekly_digest ?? true,
            storm_alerts: data.sms_storm_alerts ?? false,
          });
        }
      })
      .catch(() => { /* use defaults */ });
  }, []);

  function toggleNotif(key: keyof typeof notifPrefs) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setNotifSaved(false);
  }

  async function handleSaveNotifs() {
    setNotifSaving(true);
    try {
      const payload = {
        sms_new_lead: notifPrefs.sms_new_leads,
        email_new_lead: notifPrefs.email_new_leads,
        email_weekly_digest: notifPrefs.weekly_report,
        sms_storm_alerts: notifPrefs.storm_alerts,
      };
      const res = await fetch("/api/profile/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setNotifSaved(true);
        addToast({
          type: "success",
          title: "Preferences saved",
          description: "Your notification settings were updated.",
          duration: 3500,
        });
        setTimeout(() => setNotifSaved(false), 3000);
      } else {
        // Non-2xx response: surface the failure so the user knows the
        // toggles are still pending and can retry.
        addToast({
          type: "error",
          title: "Couldn't save preferences",
          description:
            "We couldn't update your notification settings. Please try again.",
          duration: 6000,
        });
      }
    } catch {
      // Network error — previously this silently failed. The user kept
      // seeing stale toggles with no indication anything went wrong.
      addToast({
        type: "error",
        title: "Network error",
        description:
          "Check your connection and try saving your preferences again.",
        duration: 6000,
      });
    } finally {
      setNotifSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/login");
    } catch {
      setSigningOut(false);
    }
  }

  // Password-reset handler was removed entirely. Henri is Google-OAuth only
  // per CLAUDE.md; there are no password-based accounts to reset, and the
  // /reset-password route no longer exists. Google users manage credentials
  // at myaccount.google.com — see the "Google security" link surfaced
  // lower on this page for the Google-provider branch.

  // Beta-locked fallback: Founder ($149, 3 ZIPs) per CLAUDE.md.
  const planSlug = profile?.plan ?? "founder";
  const plan = PLAN_INFO[planSlug] ?? PLAN_INFO.founder ?? PLAN_INFO.starter;
  const maxZips = PLAN_ZIP_LIMITS[planSlug] ?? 5;
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  /* ─── Loading state ─── */
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48 mt-2" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="font-heading font-normal text-2xl text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account, plan, and preferences
        </p>
      </div>

      {/* ── Licensing (high-visibility because lead generation depends on it) ── */}
      <LicensingSection />

      {/* ── 1. Account Information ── */}
      <Section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">
            Account Information
          </h2>
          <Link
            href="/settings/account"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Edit profile
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="space-y-4">
          {/* Company */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Company</p>
              <p className="text-sm font-medium text-foreground">
                {profile?.company_name || "Not set"}
              </p>
            </div>
          </div>

          {/* Email */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
              <Mail className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium text-foreground">
                {user?.email ?? "---"}
              </p>
            </div>
          </div>

          {/* Phone */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
              <Phone className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-sm font-medium text-foreground">
                {profile?.phone || "Not set"}
              </p>
            </div>
          </div>

          {/* Plan badge + Member since */}
          <div className="flex items-center gap-6 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                <CreditCard className="h-3 w-3" />
                {plan.label} {plan.price}
              </span>
            </div>
            {memberSince && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Member since {memberSince}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── 2. Territory Overview ── */}
      <Section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">
            Territory Overview
          </h2>
          <Link
            href="/settings/territories"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Manage territories
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Up to {maxZips} ZIP codes on {plan.label} plan
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              View and manage your active territories in Territory settings.
              Changes take effect at the next billing cycle.
            </p>
          </div>
        </div>
      </Section>

      {/* ── 3. Notification Preferences ── */}
      <Section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">
            Notification Preferences
          </h2>
          <Link
            href="/settings/notifications"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            All notifications
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <fieldset className="space-y-0 border border-border rounded-lg overflow-hidden divide-y divide-border">
          <legend className="sr-only">Notification preferences</legend>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  New leads (SMS)
                </p>
                <p className="text-xs text-muted-foreground">
                  Instant text when a lead arrives
                </p>
              </div>
            </div>
            <Toggle
              aria-label="New leads (SMS)"
              checked={notifPrefs.sms_new_leads}
              onChange={() => toggleNotif("sms_new_leads")}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  New leads (Email)
                </p>
                <p className="text-xs text-muted-foreground">
                  Full lead details sent to your inbox
                </p>
              </div>
            </div>
            <Toggle
              aria-label="New leads (Email)"
              checked={notifPrefs.email_new_leads}
              onChange={() => toggleNotif("email_new_leads")}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Weekly report
                </p>
                <p className="text-xs text-muted-foreground">
                  Summary of leads, wins, and territory activity
                </p>
              </div>
            </div>
            <Toggle
              aria-label="Weekly report"
              checked={notifPrefs.weekly_report}
              onChange={() => toggleNotif("weekly_report")}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Storm alerts
                </p>
                <p className="text-xs text-muted-foreground">
                  Severe weather alerts for your territories
                </p>
              </div>
            </div>
            <Toggle
              aria-label="Storm alerts"
              checked={notifPrefs.storm_alerts}
              onChange={() => toggleNotif("storm_alerts")}
            />
          </div>
        </fieldset>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSaveNotifs}
            disabled={notifSaving}
            className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {notifSaving ? "Saving..." : "Save"}
          </button>
          {notifSaved && (
            <span className="text-xs text-green-600">Preferences saved</span>
          )}
        </div>
      </Section>

      {/* ── 4. Billing ── */}
      <Section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">Billing</h2>
          <Link
            href="/settings/billing"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Manage billing
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {plan.label} plan &middot; {plan.price}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Next billing date available in{" "}
              <Link
                href="/settings/billing"
                className="text-primary hover:underline"
              >
                billing settings
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Link
            href="/settings/billing"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View plans & invoices
          </Link>
        </div>
      </Section>

      {/* ── 5. Security ── */}
      <Section>
        <h2 className="text-base font-semibold text-foreground mb-4">
          Security
        </h2>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Sign-in method</p>
                {/* Henri is Google-OAuth only per CLAUDE.md. The only
                 * account surface is Google itself — no Supabase
                 * password-reset link exists to send. */}
                <p className="text-xs text-muted-foreground">
                  Managed by your Google account
                </p>
              </div>
            </div>
            <a
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Google security
            </a>
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
                  <PlayCircle className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Replay tutorial
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Walk through the dashboard tour again
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    // Reset the DB flag so the auto-fire condition is true on
                    // the next dashboard mount.
                    await fetch("/api/profile/tutorial", { method: "DELETE" });
                    // Set the localStorage trigger so the tour fires immediately
                    // when we land on /dashboard, without waiting for the
                    // profile refresh round-trip.
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("henri:tutorial:requested-replay", "1");
                    }
                    addToast({
                      type: "success",
                      title: "Tutorial reset",
                      description: "Heading to the dashboard…",
                    });
                    router.push("/dashboard");
                  } catch (err) {
                    addToast({
                      type: "error",
                      title: "Couldn't reset tutorial",
                      description: err instanceof Error ? err.message : "Try again.",
                    });
                  }
                }}
                className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Replay
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center shrink-0">
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Sign out
                  </p>
                  <p className="text-xs text-muted-foreground">
                    End your current session
                  </p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
              >
                {signingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 6. Danger Zone ── */}
      <Section className="border-red-500/20">
        <h2 className="text-base font-semibold text-red-500 mb-4">
          Danger Zone
        </h2>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Cancel subscription
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cancel anytime. Your account stays active through the end of the
                current billing cycle &mdash; no further charges. After that, your
                account data is removed prior to the next billing date. No
                refunds for digital products.
              </p>
            </div>
            <Link
              href="/settings/billing"
              className="shrink-0 px-4 py-2 text-sm font-medium border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/5 transition-colors"
            >
              Manage
            </Link>
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Need help?
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Contact our support team for account issues, billing
                  questions, or feature requests.
                </p>
              </div>
              <a
                href="mailto:support@meethenri.com"
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                Contact support
              </a>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
