"use client";

import { useState, useMemo } from "react";
import { CheckCircle, AlertTriangle, Clock, RefreshCw, Shield, FileText, Calendar, Plus } from "lucide-react";
import { useCompliance } from "@/hooks/useCompliance";
import { useLeads } from "@/hooks/useLeads";
import { Skeleton } from "@/components/ui/skeleton";
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
  expiry_date: string | null;
}

/* ─── Constants ─── */
const PERMIT_VALIDITY_DAYS = 180;

/* ─── Helpers ─── */
function statusIcon(status: string, expiryDate: string | null) {
  if (status === "verified") {
    const daysUntilExpiry = expiryDate
      ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000)
      : null;
    if (daysUntilExpiry !== null && daysUntilExpiry < 60) {
      return <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />;
    }
    return <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />;
  }
  if (status === "failed" || status === "expired") {
    return <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />;
  }
  return <Clock className="h-5 w-5 text-yellow-400 shrink-0" />;
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
    proposal: { label: "Proposal", cls: "bg-yellow-500/10 text-yellow-400" },
    under_review: { label: "Under Review", cls: "bg-yellow-500/10 text-yellow-400" },
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDate(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(dateStr).toLocaleDateString("en-US", opts ?? { month: "short", day: "numeric", year: "numeric" });
}

/** Map Lead objects to permit rows for the table */
function leadsToPermitRows(leads: Lead[]): PermitRow[] {
  return leads
    .filter((l) => l.permit_filed_date)
    .map((l) => {
      const filedDate = l.permit_filed_date!;
      const expiryDate = addDays(filedDate, PERMIT_VALIDITY_DAYS);
      const now = new Date().toISOString().split("T")[0];
      const isExpired = expiryDate < now;

      return {
        id: l.id,
        address: l.address,
        city: l.city ?? "",
        state: l.state ?? "",
        permit_type: l.trade ?? l.permit_type ?? "General",
        permit_id: l.permit_id,
        status: isExpired ? "expired" : l.status,
        filed_date: filedDate,
        expiry_date: expiryDate,
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
        detail: "License has expired — leads paused until renewed",
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
      detail: `${license.license_state}${license.license_type ? ` ${license.license_type}` : ""} license active — daily auto-verification enabled`,
    });
  }

  return events;
}

/* ─── Compliance Score ─── */
function ComplianceScore({
  license,
  insuranceExpiry,
  apiScore,
}: {
  license: LicenseRecord | null;
  insuranceExpiry: string | null;
  apiScore: number;
}) {
  const insuranceDays = daysUntil(insuranceExpiry);
  const hasInsurance = insuranceExpiry !== null;

  // Weights must sum to 100 — keeping them in the UI makes it obvious
  // which checklist item to fix first when the score is low (Phase 2.4).
  const items = [
    { label: "License on file", weight: 20, ok: !!license },
    { label: "License verified", weight: 20, ok: license?.verification_status === "verified" },
    { label: "License not expiring (<60d)", weight: 10, ok: license?.expiry_date ? (daysUntil(license.expiry_date) ?? 0) > 60 : false },
    { label: "Insurance on file", weight: 30, ok: hasInsurance },
    { label: "Insurance not expiring (<30d)", weight: 20, ok: hasInsurance && insuranceDays !== null && insuranceDays > 30 },
  ];
  const pct = apiScore;

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
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
    </div>
  );
}

/* ─── Page ─── */
export default function CompliancePage() {
  const {
    license: hookLicense,
    insuranceExpiry,
    permits: apiPermits,
    complianceScore,
    warnings,
    isLoading,
    refresh,
  } = useCompliance();

  const { data: leads, isLoading: leadsLoading } = useLeads();

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");

  // Map hook license to LicenseRecord interface used by existing UI
  const license: LicenseRecord | null = hookLicense
    ? {
        id: hookLicense.number,
        license_number: hookLicense.number,
        license_state: hookLicense.state,
        license_type: hookLicense.type,
        verification_status: hookLicense.verified ? "verified" : "pending_verification",
        expiry_date: hookLicense.expiry,
        last_checked_at: hookLicense.verified_at,
      }
    : null;

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

  // Expiration warnings for permits from real data
  const expiringPermits = useMemo(() => {
    return permitRows.filter((p) => {
      if (!p.expiry_date || p.status === "expired") return false;
      const days = daysUntil(p.expiry_date);
      return days !== null && days <= 30 && days > 0;
    });
  }, [permitRows]);

  async function runComplianceCheck() {
    setChecking(true);
    setCheckMsg("");
    try {
      // Trigger a server-side re-check (license + permit expirations),
      // then refresh the local compliance snapshot so the new state
      // appears in the UI.
      const res = await fetch("/api/compliance/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const result = await res.json() as {
        license: { expired: boolean; expiring_soon: boolean; leads_paused: boolean };
        permits: { already_expired: number; expiring_in_30d: number };
      };
      await refresh();
      const pieces: string[] = [];
      if (result.license.expired) pieces.push("License EXPIRED — leads paused");
      else if (result.license.expiring_soon) pieces.push("License expires soon");
      else pieces.push("License current");
      if (result.permits.already_expired > 0) pieces.push(`${result.permits.already_expired} expired permits`);
      if (result.permits.expiring_in_30d > 0) pieces.push(`${result.permits.expiring_in_30d} expiring in 30d`);
      setCheckMsg(pieces.join(" · "));
    } catch {
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
      {warnings.length > 0 && warnings.map((w, i) => {
        const isHighSeverity = w.toLowerCase().includes("expired") || w.toLowerCase().includes("no license") || w.toLowerCase().includes("no insurance");
        const borderCls = isHighSeverity
          ? "border-red-500/30 bg-red-500/10"
          : "border-yellow-500/30 bg-yellow-500/10";
        const iconCls = isHighSeverity ? "text-red-400" : "text-yellow-400";
        const textCls = isHighSeverity ? "text-red-200" : "text-yellow-200";
        return (
          <div key={i} className={`rounded-lg border ${borderCls} px-4 py-3`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${iconCls} shrink-0`} />
              <p className={`text-sm ${textCls} font-medium`}>{w}</p>
            </div>
          </div>
        );
      })}

      {/* Permit Expiration Warnings */}
      {warnings.length === 0 && expiringPermits.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-200 font-medium">Permit Expiration Warning</p>
          </div>
          {expiringPermits.map((p) => (
            <p key={p.id} className="text-xs text-yellow-300/80 ml-6">
              {p.permit_type} at {p.address}{p.city ? `, ${p.city}` : ""} — expires in {daysUntil(p.expiry_date)} days
            </p>
          ))}
        </div>
      )}

      {/* Compliance Score + License Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ComplianceScore license={license} insuranceExpiry={insuranceExpiry} apiScore={complianceScore} />

        {/* License Card */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
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
                <p className={`text-xs font-medium ${expiryDays !== null && expiryDays < 60 ? "text-yellow-500" : "text-muted-foreground"}`}>
                  Expires {formatDate(license.expiry_date, { month: "short", day: "numeric", year: "numeric" })}
                  {expiryDays !== null && expiryDays < 60 && ` — ${expiryDays} days remaining`}
                </p>
              )}
              {license.last_checked_at && (
                <p className="text-xs text-muted-foreground">
                  Last verified {formatDate(license.last_checked_at, { month: "short", day: "numeric" })}
                </p>
              )}
              <p className="text-[10px] text-green-400">Henri verifies your license daily</p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-sm font-medium text-foreground">No license on file</p>
                <a href="/onboarding/license" className="text-xs text-primary hover:underline">Add your license</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Insurance Card */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
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
              <p className="text-xs text-muted-foreground">
                Connect your insurance to improve your compliance score and unlock full lead delivery
              </p>
            </div>
            <a
              href="/settings/account"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Connect your insurance
            </a>
          </div>
        )}
      </div>

      {/* Active Permits Tracker */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-heading font-normal text-foreground">Active Permits</h2>
          {permitCount > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">{permitCount} permit{permitCount !== 1 ? "s" : ""} from your leads</span>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {leadsLoading ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
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
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Expires</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {permitRows.map((p) => {
                  const days = daysUntil(p.expiry_date);
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
                      <td className="px-4 py-3">
                        {p.expiry_date ? (
                          <span className={days !== null && days <= 30 ? "text-yellow-400 font-medium" : "text-muted-foreground"}>
                            {formatDate(p.expiry_date, { month: "short", day: "numeric" })}
                            {days !== null && days <= 30 && days > 0 && ` (${days}d)`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{permitStatusBadge(p.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Verification Timeline */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Verification History</h2>
        <div className="rounded-lg border border-border bg-card p-5">
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
              <a href="/onboarding/license" className="text-xs text-primary hover:underline">
                Add your license to start daily verification
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
        </div>
      </div>

      {/* Run Check */}
      <div className="flex items-center gap-4">
        <button
          onClick={runComplianceCheck}
          disabled={checking || isLoading}
          className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking..." : "Run Compliance Check"}
        </button>
        {checkMsg && <p className="text-sm text-muted-foreground">{checkMsg}</p>}
      </div>
    </div>
  );
}
