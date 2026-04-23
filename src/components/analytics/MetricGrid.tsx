"use client";

import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
}

function MetricCard({ label, value, sub, subColor }: MetricCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-normal text-foreground mt-1 font-heading">{value}</p>
      {sub && (
        <p className={cn("text-xs mt-1", subColor ?? "text-muted-foreground")}>{sub}</p>
      )}
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export interface MetricGridProps {
  leadsReceived?: number;
  contactRate?: number;
  quoteRate?: number;
  jobsWon?: number;
  revenue?: number;
  avgResponseH?: number;
  costPerWin?: number | null;
  roi?: number | null;
  planPrice?: number;
  isLoading?: boolean;
}

export function MetricGrid({
  leadsReceived,
  contactRate,
  quoteRate,
  jobsWon,
  revenue,
  avgResponseH,
  costPerWin,
  roi,
  planPrice,
  isLoading,
}: MetricGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[...Array(7)].map((_, i) => <MetricCardSkeleton key={i} />)}
      </div>
    );
  }

  const totalLeads = leadsReceived ?? 0;
  const contacted = contactRate != null ? Math.round((contactRate / 100) * totalLeads) : null;
  const quoted = quoteRate != null && contacted != null ? Math.round((quoteRate / 100) * contacted) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <MetricCard
        label="Leads Received"
        value={totalLeads > 0 ? String(totalLeads) : "—"}
        sub={totalLeads > 0 ? "Last 30 days" : "No leads yet"}
        subColor={totalLeads > 0 ? "text-[#3D9970]" : undefined}
      />
      <MetricCard
        label="Contact Rate"
        value={contactRate != null ? `${Math.round(contactRate)}%` : "—"}
        sub={contacted != null ? `${contacted} of ${totalLeads} leads` : "No data"}
      />
      <MetricCard
        label="Quote Rate"
        value={quoteRate != null ? `${Math.round(quoteRate)}%` : "—"}
        sub={quoted != null && contacted != null ? `${quoted} of ${contacted} contacted` : "No data"}
      />
      <MetricCard
        label="Jobs Won"
        value={jobsWon != null ? String(jobsWon) : "—"}
        sub={revenue ? `$${Math.round(revenue / 1000)}K revenue` : "No wins yet"}
        subColor={jobsWon ? "text-[#3D9970]" : undefined}
      />
      <MetricCard
        label="Avg Response Time"
        value={avgResponseH != null ? `${avgResponseH.toFixed(1)}h` : "—"}
        sub="Time to first contact"
      />
      <MetricCard
        label="Cost Per Win"
        value={costPerWin != null ? `$${Math.round(costPerWin)}` : "—"}
        sub="Industry avg $180+"
      />
      <MetricCard
        label="Henri ROI"
        value={roi != null ? `${roi.toFixed(1)}x` : "—"}
        sub={planPrice ? `$${planPrice}/mo subscription` : ""}
        subColor="text-primary"
      />
    </div>
  );
}
