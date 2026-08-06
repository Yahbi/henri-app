"use client";

import { useState, useMemo } from "react";
import { CheckCircle, AlertTriangle, Clock, RefreshCw, Shield, FileText, Calendar, Plus } from "lucide-react";
import { useCompliance } from "@/hooks/useCompliance";
import { useLeads } from "@/hooks/useLeads";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import type { Lead } from "@/types/lead";

/* ─── Types ─── */
interface LicenseRecord {
  id: string;
  license_number: string;
  license_state: string;
  license_type: string | null;
  verification_status: string;
  expiry_date: string | null;
  last_checked_at: string | null;
}

interface VerificationEvent {
  date: string;
  status: string;
  detail: string;
}

interface PermitRow {
  id: string;
  address: string;
  city: string;
  state: string;
  permit_type: string;
  permit_id: string;
  status: string;
  filed_date: string;
  /** Elapsed days since the jurisdiction's filing date. NOT a countdown —
   *  see the note on `leadsToPermitRows`. */
  days_since_filed: number;
}

/* ─── Helpers ─── */
function statusIcon(status: string, expiryDate: string | null) {
  if (status === "verified") {
    const daysUntilExpiry = expiryDate
      ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000)
      : null;
    if (daysUntilExpiry !== null && daysUntilExpiry < 60) {
      return <AlertTriangle className="h-5 w-5 text-warning shrink-0" />;
    }
    return <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />;
  }
  if (status === "failed" || status === "expired") {
    return <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />;
  }
  return <Clock className="h-5 w-5 text-warning shrink-0" />;
}

function statusLabel(status: string) {
  switch (status) {
    case "verified": return "Verified";
    case "pending_verification": return "Pending review";
    case "failed": return "Verification failed";
    case "expired": return "Expired";
    default: return "Unknown";
  }
}

function permitStatusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    approved: { label: "Approved", cls: "bg-green-500/10 text-green-400" },
    active: { label: "Active", cls: "bg-green-500/10 text-green-400" },
    new: { label: "New", cls: "bg-blue-500/10 text-blue-400" },
    contacted: { label: "Contacted", cls: "bg-blue-500/10 text-blue-400" },
    quoted: { label: "Quoted", cls: "bg-blue-500/10 text-blue-400" },
    proposal: { label: "Proposal", cls: "bg-warning/10 text-warning" },
    under_review: { label: "Under Review", cls: "bg-warning/10 text-warning" },
    submitted: { label: "Submitted", cls: "bg-blue-500/10 text-blue-400" },
    won: { label: "Won", cls: "bg-green-500/10 text-green-400" },
    lost: { label: "Lost", cls: "bg-red-500/10 text-red-400" },
    expired: { label: "Expired", cls: "bg-red-500/10 text-red-400" },
    archived: { label: "Archived", cls: "bg-zinc-500/10 text-muted-foreground" },
  };
  const cfg = map[status] ?? { label: status, cls: "bg-zinc-500/10 text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function daysSince(dateStr: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000),
  );
}

function formatDate(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(dateStr).toLocaleDateString("en-US", opts ?? { month: "short", day: "numeric", year: "numeric" });
}

/** Map Lead objects to permit rows for the table.
 *
 * 2026-08-06 truthfulness pass — permit EXPIRY is gone from this file.
 *
 * There was a `PERMIT_VALIDITY_DAYS = 180` constant here, added to the
 * filing date to produce an "Expires" calendar date, a red "Expired"
 * badge and an "expires in N days" alert banner. Henri ingests no expiry
 * data at all: no column exists anywhere in supabase/migrations (only the
 * `expired` value of the `permit_status` enum, which nothing sets from a
 * date), no scraper captures one, and permit validity is a
 * jurisdiction-by-jurisdiction rule that ranges from 60 days to
 * indefinite-while-inspections-continue. Every date in that column was
 * invented arithmetic printed as a fact a contractor would act on — the
 * expensive failure being skipping a live lead because Henri said its
 * permit had lapsed.
 *
 * The status override was the second half of the same defect: it replaced
 * the contractor's OWN CRM status, so a lead they had marked `won`
 * displayed as "Expired" once the filing date passed 180 days.
 *
 * What ships instead is the one thing the join actually knows — elapsed
 * days since the jurisdiction's filing date. If a real expiry field is
 * ever ingested, add it as its own column here; do not re-derive one.
 */
function leadsToPermitRows(leads: Lead[]): PermitRow[] {
  return leads
    .filter((l) => l.permit_filed_date)
    .map((l) => {
      const filedDate = l.permit_filed_date!;

      return {
        id: l.id,
        address: l.address,
        city: l.city ?? "",
        state: l.state ?? "",
        permit_type: l.trade ?? l.permit_type ?? "General",
        permit_id: l.permit_id,
        status: l.status,
        filed_date: filedDate,
        days_since_filed: daysSince(filedDate),
      };
    });
}

/** Build verification timeline from license data */
function buildVerificationHistory(license: LicenseRecord | null): VerificationEvent[] {
  if (!license) return [];

  const events: VerificationEvent[] = [];

  // Most recent verification
  if (license.last_checked_at) {
    const isVerified = license.verification_status === "verified";
    events.push({
      date: formatDate(license.last_checked_at, { month: "short", day: "numeric", year: "numeric" }),
      status: isVerified ? "verified" : "warning",
      detail: isVerified
        ? `License #${license.license_number} verified in ${license.license_state}`
        : `License #${license.license_number} verification pending`,
    });
  }

  // Expiry warning
  if (license.expiry_date) {
    const days = daysUntil(license.expiry_date);
    if (days !== null && days < 60 && days > 0) {
      events.push({
        date: formatDate(license.expiry_date, { month: "short", day: "numeric", year: "numeric" }),
        status: "warning",
        detail: `License expires in ${days} days — renewal recommended`,
      });
    } else if (days !== null && days <= 0) {
      events.push({
        date: formatDate(license.expiry_date, { month: "short", day: "numeric", year: "numeric" }),
        status: "failed",
        // 2026-08-05 truthfulness pass: was "leads paused until renewed".
        // Nothing pauses. No lead-delivery path reads license expiry —
        // the score cron, the leads query and the notification dispatch
        // all ignore contractor_licenses entirely. Telling a contractor
        // their feed has stopped when it has not is worse than saying
        // nothing: it invites them to ignore a real renewal deadline.
        detail: "License has expired — renew to stay compliant",
      });
    }
  }

  // Initial record
  if (license.verification_status === "verified") {
    events.push({
      date: license.last_checked_at
        ? formatDate(license.last_checked_at, { month: "short", day: "numeric", year: "numeric" })
        : "On file",
      status: "verified",
      // 2026-08-05 truthfulness pass: was "daily auto-verification enabled".
      // src/lib/license/verify.ts contacts no licensing board on any code
      // path — every branch returns `pending`, and recheckLicense() just
      // calls back into it, so no cron can detect a revocation or a lapse.
      // The one check that genuinely runs is the roster cross-check at
      // signup (/api/onboarding/verify-license against
      // state_license_rosters), which is what this line now describes.
      detail: `${license.license_state}${license.license_type ? ` ${license.license_type}` : ""} license on file — matched against the ${license.license_state} state license roster at signup`,
    });
  }

  return events;
}

/* ─── Compliance Score ─── */
function ComplianceScore({
  license,
  insuranceExpiry,
  territories,
  apiScore,
}: {
  license: LicenseRecord | null;
  insuranceExpiry: string | null;
  territories: Array<{ active: boolean }>;
  apiScore: number;
}) {
  /* 2026-08-06 truthfulness pass — this checklist used to advertise a
   * scoring formula the product does not use.
   *
   * The weights shown were license-on-file 20 / verified 20 / not-expiring
   * 10 / insurance-on-file 30 / insurance-not-expiring 20, while the number
   * in the circle beside them is `compliance_score` from
   * /api/compliance (computeComplianceScore), which weights
   * license 40 / verified 20 / insurance 20 / territories-active 20. So the
   * panel that exists to tell a contractor what to fix first pointed at the
   * wrong item: insurance read as half the score when it is a fifth, and
   * "all territories active" — a real 20 points — had no row at all.
   *
   * The "<60d" row was worse than merely mis-weighted. `expiry_date` is a
   * roster-owned column (migration 00127 rejects hand-set values, and the
   * only writer is the signup cross-check, which covers 9 states), so for
   * most contractors it is null — and the ternary evaluated null as a
   * FAILURE. They got a permanent red X on a row they had no way to clear
   * while the server happily awarded the full 40 points. It is gone: the
   * server has no such component, and an expiry the roster never supplied
   * cannot be scored.
   *
   * These four rows now mirror computeComplianceScore in
   * src/app/api/compliance/route.ts one-for-one. THAT FUNCTION IS THE
   * SOURCE OF TRUTH — if you change a weight there, change it here in the
   * same commit. (The API's breakdown is not plumbed through useCompliance
   * today; doing so is the durable fix and would let this array be
   * deleted.)
   */
  const insuranceDays = daysUntil(insuranceExpiry);
  const insuranceValid = insuranceDays !== null && insuranceDays > 0;

  const licenseExpiryDays = daysUntil(license?.expiry_date ?? null);
  const licenseExpired = licenseExpiryDays !== null && licenseExpiryDays <= 0;

  // Via the module-scope helper — `Date.now()` inline in a component body
  // trips the react-hooks/purity rule.
  const verifiedSinceDays =
    license?.last_checked_at != null ? daysSince(license.last_checked_at) : null;

  const items = [
    {
      label: "License on file and not expired",
      weight: 40,
      ok: !!license?.license_number && !licenseExpired,
    },
    {
      label: "License checked in the last 30 days",
      weight: 20,
      ok:
        license?.verification_status === "verified" &&
        verifiedSinceDays !== null &&
        verifiedSinceDays <= 30,
    },
    {
      label: "Insurance on file and not expired",
      weight: 20,
      ok: insuranceValid,
    },
    {
      label: "All claimed territories active",
      weight: 20,
      ok: territories.length > 0 && territories.every((t) => t.active),
    },
  ];
  const pct = apiScore;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-heading font-normal text-foreground">Compliance Score</h2>
      </div>
      <div className="flex items-center gap-6">
        {/* Score circle */}
        <div className="relative h-24 w-24 shrink-0">
          <svg className="h-24 w-24 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.91" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
            <circle
              cx="18" cy="18" r="15.91" fill="none"
              stroke={pct >= 80 ? "#3D9970" : pct >= 50 ? "#D4A24A" : "#ef4444"}
              strokeWidth="2.5"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xl font-heading font-normal text-foreground">
            {pct}%
          </span>
        </div>
        {/* Checklist — % weight next to each item so the contractor
            sees exactly where to invest when their score is low. */}
        <div className="space-y-1.5 flex-1">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm">
              {item.ok ? (
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              )}
              <span className={item.ok ? "text-foreground" : "text-red-400"}>
                {item.label}
              </span>
              <span
                className={`ml-auto text-xs tabular-nums ${
                  item.ok ? "text-muted-foreground" : "text-red-400/70"
                }`}
              >
                {item.weight}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ─── Page ─── */
export default function CompliancePage() {
  const {
    license: hookLicense,
    insuranceExpiry,
    // `territories` carries 20 of the 100 compliance points server-side, so
    // the checklist needs it to render a row that matches the score.
    territories,
    complianceScore,
    warnings,
    isLoading,
    error: complianceError,
    refresh,
  } = useCompliance();

  const { data: leads, isLoading: leadsLoading, error: leadsError, refetch: refetchLeads } = useLeads();

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");
  const [checkFailed, setCheckFailed] = useState(false);

  // Map hook license to LicenseRecord interface used by existing UI
  const license: LicenseRecord | null = useMemo(
    () =>
      hookLicense
        ? {
            id: hookLicense.number,
            license_number: hookLicense.number,
            license_state: hookLicense.state,
            license_type: hookLicense.type,
            verification_status: hookLicense.verified ? "verified" : "pending_verification",
            expiry_date: hookLicense.expiry,
            last_checked_at: hookLicense.verified_at,
          }
        : null,
    [hookLicense],
  );

  const loading = isLoading;

  // Map leads to permit rows
  const permitRows = useMemo(() => {
    if (!leads || leads.length === 0) return [];
    return leadsToPermitRows(leads);
  }, [leads]);

  const permitCount = permitRows.length;

  // Build verification history from real license data
  const verificationHistory = useMemo(() => {
    return buildVerificationHistory(license);
  }, [license]);

  // 2026-08-06: the `expiringPermits` memo and the "Permit Expiration
  // Warning" banner it fed were deleted with the rest of the invented
  // 180-day expiry (see leadsToPermitRows). The banner named a specific
  // address and a specific day count for a deadline no jurisdiction ever
  // issued, which is the most actionable form the fabrication took.

  async function runComplianceCheck() {
    setChecking(true);
    setCheckMsg("");
    setCheckFailed(false);
    try {
      // Trigger the server-side license re-check, then refresh the local
      // compliance snapshot so the new state appears in the UI.
      const res = await fetch("/api/compliance/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      // 2026-08-06: the `permits` half of this response is gone. It reported
      // `already_expired` / `expiring_in_30d` counts derived from the same
      // invented 180-day validity window removed above — and computed them
      // over an arbitrary slice of leads at that (the route asked for 5,000
      // rows, which PostgREST silently caps at 1,000, unordered). Deleted in
      // /api/compliance/verify rather than paginated: a bounded sample of a
      // number that should not exist is still a number that should not exist.
      const result = await res.json() as {
        license: { expired: boolean; expiring_soon: boolean };
      };
      await refresh();
      const pieces: string[] = [];
      // 2026-08-05 truthfulness pass: was "License EXPIRED — leads paused".
      // /api/compliance/verify returns `leads_paused: licenseExpired`, but
      // that flag is never acted on anywhere — no delivery path gates on
      // license state. The route also treats a MISSING licensed_until as
      // expired (route.ts:40-42), so this banner claimed a paused feed for
      // every contractor who simply has no expiry date on file.
      if (result.license.expired) pieces.push("License expired or no expiry on file");
      else if (result.license.expiring_soon) pieces.push("License expires soon");
      else pieces.push("License current");
      setCheckMsg(pieces.join(" · "));
    } catch {
      setCheckFailed(true);
      setCheckMsg("Check failed — please try again.");
    } finally {
      setChecking(false);
    }
  }

  const expiryDays = license?.expiry_date ? daysUntil(license.expiry_date) : null;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Compliance Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">License, insurance, permits, and bonding status</p>
      </div>

      {/* API Warnings */}
      {/* Warning banners use the semantic --destructive / --warning tokens,
       * which are defined for light, dusk AND dark. The previous
       * text-red-200 / text-yellow-200 ramps are dark-theme values and
       * measured ~1.05:1 against their own tint on the default light
       * theme — the banners were effectively blank coloured strips, and
       * several of these warnings render nowhere else on the page. */}
      {warnings.length > 0 && warnings.map((w, i) => {
        const isHighSeverity = w.toLowerCase().includes("expired") || w.toLowerCase().includes("no license") || w.toLowerCase().includes("no insurance");
        const borderCls = isHighSeverity
          ? "border-destructive/30 bg-destructive/10"
          : "border-warning/30 bg-warning/10";
        const textCls = isHighSeverity ? "text-destructive" : "text-warning";
        return (
          <div key={i} role="alert" className={`rounded-lg border ${borderCls} px-4 py-3`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${textCls} shrink-0`} aria-hidden="true" />
              <p className={`text-sm ${textCls} font-medium`}>{w}</p>
            </div>
          </div>
        );
      })}

      {complianceError && (
        /* A fetch failure must not read as genuine non-compliance — surface
         * the load error + retry instead of a false 0-score / no-license. */
        <Card role="alert" className="flex items-center justify-between gap-3 p-4 border-destructive/30">
          <p className="text-sm text-destructive">
            {complianceError} This isn&apos;t your real compliance status — retry.
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="text-sm font-medium text-destructive underline underline-offset-2 hover:opacity-80"
          >
            Retry
          </button>
        </Card>
      )}

      {/* Compliance Score + License Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ComplianceScore
          license={license}
          insuranceExpiry={insuranceExpiry}
          territories={territories}
          apiScore={complianceScore}
        />

        {/* License Card */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-heading font-normal text-foreground">Contractor License</h2>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : license ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {statusIcon(license.verification_status, license.expiry_date)}
                <span className="text-sm font-medium text-foreground">
                  {statusLabel(license.verification_status)} — #{license.license_number}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {license.license_state}{license.license_type ? ` · ${license.license_type}` : ""}
              </p>
              {license.expiry_date && (
                <p className={`text-xs font-medium ${expiryDays !== null && expiryDays < 60 ? "text-warning" : "text-muted-foreground"}`}>
                  Expires {formatDate(license.expiry_date, { month: "short", day: "numeric", year: "numeric" })}
                  {expiryDays !== null && expiryDays < 60 && ` — ${expiryDays} days remaining`}
                </p>
              )}
              {license.last_checked_at && (
                <p className="text-xs text-muted-foreground">
                  Last verified {formatDate(license.last_checked_at, { month: "short", day: "numeric" })}
                </p>
              )}
              {/* 2026-08-05: was "Henri verifies your license daily" — the
                * same board-verification claim corrected in
                * buildVerificationHistory() above. No board is contacted on
                * any code path, so there is no daily check to advertise.
                * Left standing it would have contradicted the timeline
                * directly below it. */}
              <p className="text-[10px] text-muted-foreground">
                Checked against the state license roster at signup
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div>
                <p className="text-sm font-medium text-foreground">No license on file</p>
                <a href="/onboarding/license" className="text-xs text-primary hover:underline">Add your license</a>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Insurance Card */}
      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-heading font-normal text-foreground">Insurance & Bonding</h2>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : insuranceExpiry ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center gap-1.5">
                {(() => {
                  const days = daysUntil(insuranceExpiry);
                  const isValid = days !== null && days > 0;
                  return isValid ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  );
                })()}
                <span className="text-xs text-foreground">
                  {(() => {
                    const days = daysUntil(insuranceExpiry);
                    if (days !== null && days <= 0) return "Insurance expired";
                    return "Insurance on file";
                  })()}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Expires {formatDate(insuranceExpiry, { month: "short", day: "numeric", year: "numeric" })}
                {(() => {
                  const d = daysUntil(insuranceExpiry);
                  return d !== null && d < 60 && d > 0 ? ` (${d} days)` : "";
                })()}
              </span>
              <a href="/settings/account" className="text-xs text-primary hover:underline ml-auto">Update</a>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Upload your COI in Settings to display carrier and coverage details here
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">No insurance on file</p>
              {/* 2026-08-05: "and unlock full lead delivery" removed — same
                * defect class as the "leads paused" strings corrected above.
                * No delivery path gates on insurance (or on anything else in
                * this tab), so the copy implied a throttle that does not
                * exist. The compliance-score half is true: insurance is 50 of
                * the 100 points in ComplianceScore's weights. */}
              <p className="text-xs text-muted-foreground">
                Connect your insurance to improve your compliance score
              </p>
            </div>
            <a
              href="/settings/account"
              className="inline-flex items-center gap-2 rounded-md bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity"
            >
              Connect your insurance
            </a>
          </div>
        )}
      </Card>

      {/* Active Permits Tracker */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-heading font-normal text-foreground">Active Permits</h2>
          {permitCount > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">{permitCount} permit{permitCount !== 1 ? "s" : ""} from your leads</span>
          )}
        </div>
        {/* Says out loud what the table can and can't tell you. Without
            this line the "Filed / Age" pair reads as the front half of a
            deadline, which is how the invented 180-day countdown got
            written in the first place. */}
        <p className="text-xs text-muted-foreground mb-2">
          Jurisdictions don&apos;t publish permit expiry dates in the feeds
          Henri ingests, so this table shows time elapsed since filing — not
          a deadline. Check the issuing office for validity windows.
        </p>
        <Card className="overflow-hidden">
          {leadsLoading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : leadsError ? (
            /* A lead-fetch failure must not read as "no permits" — that is
             * the difference between an outage and a genuinely empty
             * territory. */
            <div role="alert" className="flex items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your permits &mdash; check your connection and retry.
              </p>
              <button
                type="button"
                onClick={() => refetchLeads()}
                className="text-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
              >
                Retry
              </button>
            </div>
          ) : permitCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-2">
              <Calendar className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No permits found from your leads</p>
              <p className="text-xs text-muted-foreground">Permits will appear here once you have active leads with filed permit dates</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Address</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Type</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit ID</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Filed</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Age</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {permitRows.map((p) => {
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3 text-foreground">
                        {p.address}
                        {p.city && <span className="text-muted-foreground">, {p.city}{p.state ? ` ${p.state}` : ""}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.permit_type}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{p.permit_id}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(p.filed_date, { month: "short", day: "numeric" })}
                      </td>
                      {/* Elapsed time, stated neutrally. No colour ramp and
                          no threshold — an "age" that turns amber is a
                          deadline claim wearing a different label. */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.days_since_filed === 0
                          ? "Filed today"
                          : `${p.days_since_filed}d since filing`}
                      </td>
                      <td className="px-4 py-3">{permitStatusBadge(p.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Verification Timeline */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Verification History</h2>
        <Card className="p-5">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : verificationHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-2">
              <Clock className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No verification history yet</p>
              {/* 2026-08-05: was "Add your license to start daily
                * verification" — third instance of the daily-board-check
                * claim on this page. Nothing runs daily. */}
              <a href="/onboarding/license" className="text-xs text-primary hover:underline">
                Add your license to run the roster cross-check
              </a>
            </div>
          ) : (
            <div className="space-y-0">
              {verificationHistory.map((event, i) => (
                <div key={i} className="flex gap-3 pb-4 last:pb-0">
                  {/* Timeline dot + line */}
                  <div className="flex flex-col items-center">
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 mt-1.5 ${
                      event.status === "verified" ? "bg-green-500" :
                      event.status === "warning" ? "bg-yellow-500" : "bg-red-500"
                    }`} />
                    {i < verificationHistory.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1" />
                    )}
                  </div>
                  {/* Event content */}
                  <div className="pb-2">
                    <p className="text-sm text-foreground">{event.detail}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{event.date}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Run Check */}
      <div className="flex items-center gap-4">
        <button
          onClick={runComplianceCheck}
          disabled={checking || isLoading}
          className="flex items-center gap-2 rounded-md bg-cta px-5 py-2.5 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking..." : "Run Compliance Check"}
        </button>
        {checkMsg && (
          <p
            role="status"
            className={`text-sm ${checkFailed ? "text-destructive" : "text-muted-foreground"}`}
          >
            {checkMsg}
          </p>
        )}
      </div>
    </div>
  );
}
