"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLeads } from "@/hooks/useLeads";
import { formatCurrency } from "@/types/lead";
import type { Lead, LeadStatus } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Constants ── */

const TRADES = ["All", "Roofing", "HVAC", "Plumbing", "Electrical", "Solar", "General", "Painting", "Concrete"];
const STATUSES: { label: string; value: "all" | LeadStatus }[] = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Quoted", value: "quoted" },
  { label: "Won", value: "won" },
];
const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Highest Value", value: "value" },
  { label: "Highest Score", value: "score" },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]["value"];

/* ── Helpers ── */

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "1 day ago";
  if (diffD < 30) return `${diffD} days ago`;
  const diffMo = Math.floor(diffD / 30);
  return diffMo === 1 ? "1 month ago" : `${diffMo} months ago`;
}

function scoreBadge(score: number) {
  const color =
    score > 70
      ? "text-green-400 bg-green-500/10"
      : score > 40
      ? "text-[#D4A24A] bg-[rgba(212,162,74,0.12)]"
      : "text-red-400 bg-red-500/10";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

function statusBadge(status: LeadStatus) {
  const map: Record<string, string> = {
    new: "text-blue-400 bg-blue-500/10",
    contacted: "text-[#D4A24A] bg-[rgba(212,162,74,0.12)]",
    quoted: "text-purple-400 bg-purple-500/10",
    proposal: "text-purple-400 bg-purple-500/10",
    won: "text-green-400 bg-green-500/10",
    lost: "text-red-400 bg-red-500/10",
    archived: "text-muted-foreground bg-muted",
  };
  const cls = map[status] ?? "text-muted-foreground bg-muted";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}

function formatPermitValue(value: number | null | undefined): string {
  if (!value) return "--";
  return `$${value.toLocaleString()}`;
}

/* ── Skeleton Components ── */

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

function TableRowSkeleton() {
  // 11 cells to match the enriched table (address, owner, trade, permit#,
  // permit value, year built, home sqft, assessed, score, status, date).
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-14" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
      <td className="px-4 py-3"><Skeleton className="h-5 w-8 rounded-full" /></td>
      <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
      <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
    </tr>
  );
}

/* ── Page Component ── */

export default function PermitsPage() {
  const router = useRouter();
  const { data: leads, isLoading } = useLeads();

  const [tradeFilter, setTradeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  // Filter to permits only (leads that have permit data)
  const permits = useMemo(() => {
    if (!leads) return [];
    return leads.filter((l) => l.permit_id || l.permit_type || l.permit_description);
  }, [leads]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    let result = permits;

    if (tradeFilter !== "All") {
      result = result.filter(
        (l) => l.trade?.toLowerCase() === tradeFilter.toLowerCase()
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((l) => l.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortBy === "value") {
        return (b.permit_value ?? 0) - (a.permit_value ?? 0);
      }
      // score
      return b.score - a.score;
    });

    return result;
  }, [permits, tradeFilter, statusFilter, sortBy]);

  // Stats computations
  const stats = useMemo(() => {
    const total = permits.length;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = permits.filter(
      (l) => new Date(l.created_at).getTime() >= sevenDaysAgo
    ).length;

    const highValue = permits.filter(
      (l) => (l.permit_value ?? 0) > 50_000
    ).length;

    const valuesWithData = permits
      .map((l) => l.permit_value)
      .filter((v): v is number => v != null && v > 0);
    const avgValue =
      valuesWithData.length > 0
        ? Math.round(valuesWithData.reduce((a, b) => a + b, 0) / valuesWithData.length)
        : 0;

    return { total, thisWeek, highValue, avgValue };
  }, [permits]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Permits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Building permits filed in your territory
        </p>
      </div>

      {/* Stats Row */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Permits</p>
            <p className="text-2xl font-heading font-normal text-foreground mt-1">
              {stats.total}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">This Week</p>
            <p className="text-2xl font-heading font-normal text-foreground mt-1">
              {stats.thisWeek}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">High Value</p>
            <p className="text-2xl font-heading font-normal text-[#D4886A] mt-1">
              {stats.highValue}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">Avg Value</p>
            <p className="text-2xl font-heading font-normal text-foreground mt-1">
              {formatPermitValue(stats.avgValue)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={tradeFilter}
          onChange={(e) => setTradeFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by trade"
        >
          {TRADES.map((t) => (
            <option key={t} value={t}>
              {t === "All" ? "All Trades" : t}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | LeadStatus)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === "all" ? "All Statuses" : s.label}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Sort permits"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {(tradeFilter !== "All" || statusFilter !== "all") && (
          <button
            onClick={() => {
              setTradeFilter("All");
              setStatusFilter("all");
            }}
            className="text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Permits Table */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Address</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Owner</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Trade</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit #</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit value</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Year built</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Home sqft</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Assessed</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Score</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(6)].map((_, i) => (
                <TableRowSkeleton key={i} />
              ))}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-semibold text-foreground">No permits found in your territory yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            {permits.length > 0
              ? "Try adjusting your filters to see more results."
              : "Permits will appear here as they are filed in your selected ZIP codes."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Address</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Owner</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Trade</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit #</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit value</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Year built</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Home sqft</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Assessed</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Score</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((permit) => {
                const ownerName =
                  permit.owner_first || permit.owner_last
                    ? [permit.owner_first, permit.owner_last].filter(Boolean).join(" ")
                    : permit.owner_name ?? "Unknown";
                const address = [permit.address, permit.city, permit.state]
                  .filter(Boolean)
                  .join(", ");
                const permitNumber = permit.permit_id || "--";
                const dateStr = permit.permit_filed_date ?? permit.created_at;

                return (
                  <tr
                    key={permit.id}
                    onClick={() => router.push(`/dashboard/leads/${permit.id}`)}
                    className="border-b border-border last:border-b-0 hover:bg-bg-subtle transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-foreground font-medium">{permit.address}</p>
                        {(permit.city || permit.state || permit.zip) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[permit.city, permit.state, permit.zip].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{ownerName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{permit.trade ?? "--"}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {permitNumber}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatPermitValue(permit.permit_value)}
                    </td>
                    {/* Year built / sqft / assessed value come from the
                     * county-GIS enrichment cron. Dash for leads in
                     * jurisdictions we haven't wired yet. */}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {permit.year_built ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {permit.home_sqft
                        ? Number(permit.home_sqft).toLocaleString()
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {permit.assessed_value
                        ? formatCurrency(permit.assessed_value)
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">{scoreBadge(permit.score)}</td>
                    <td className="px-4 py-3">{statusBadge(permit.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {relativeTime(dateStr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
