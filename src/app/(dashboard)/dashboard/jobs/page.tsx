"use client";

import { useState, useMemo } from "react";
import { useLeads, useUpdateLeadStatus } from "@/hooks/useLeads";
import { formatCurrency } from "@/types/lead";
import type { Lead, LeadStatus } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { Loader2, CalendarDays } from "lucide-react";

// Jobs track won leads through their delivery lifecycle
type JobStage = "scheduled" | "in_progress" | "punch_list" | "complete" | "invoiced";

interface JobColumnDef {
  id: JobStage;
  label: string;
  dotColor: string;
  description: string;
}

/* Job-stage column dotColors — fed to inline `style={{ background:
 * col.dotColor }}`. Migrated to `var()` references on 2026-04-25 per
 * design-system audit priority action #4. The "Punch List" purple has
 * no semantic token (no `--purple` in palette) so stays as a literal. */
const JOB_COLUMNS: JobColumnDef[] = [
  { id: "scheduled",   label: "Scheduled",   dotColor: "var(--hot)",            description: "Date set, work pending" },
  { id: "in_progress", label: "In Progress", dotColor: "var(--warm)",           description: "Crew on site" },
  { id: "punch_list",  label: "Punch List",  dotColor: "#8B5CF6",               description: "Final items outstanding" },
  { id: "complete",    label: "Complete",    dotColor: "hsl(var(--success))",   description: "Work finished" },
  { id: "invoiced",    label: "Invoiced",    dotColor: "var(--cool)",           description: "Invoice sent / paid" },
];

/* Trade pill colours — same pattern as KanbanBoard / LeadCard. Each
 * Henri trade has matching `--trade-*-fg` + `--trade-*-tint` tokens. */
const TRADE_COLORS: Record<string, { bg: string; text: string }> = {
  roofing:           { bg: "bg-trade-roofing-tint",    text: "text-trade-roofing" },
  hvac:              { bg: "bg-trade-hvac-tint",       text: "text-trade-hvac" },
  plumbing:          { bg: "bg-trade-plumbing-tint",   text: "text-trade-plumbing" },
  electrical:        { bg: "bg-trade-electrical-tint", text: "text-trade-electrical" },
  solar:             { bg: "bg-trade-solar-tint",      text: "text-trade-solar" },
  adu:               { bg: "bg-trade-adu-tint",        text: "text-trade-adu" },
  "general remodel": { bg: "bg-trade-general-tint",    text: "text-trade-general" },
};

function tradeBadgeColors(trade: string): { bg: string; text: string } {
  const key = trade.toLowerCase();
  return TRADE_COLORS[key] ?? { bg: "bg-trade-general-tint", text: "text-trade-general" };
}

// Read job stage with a tiny migration path:
//   1. Prefer the new `leads.job_stage` column (Phase 2.1 migration)
//   2. Fall back to the legacy `{"job_stage":"…"}` JSON-prefixed notes line
//      so this tab keeps working for won-leads written before the migration
//   3. Default to "scheduled" when neither is set
function getJobStage(lead: Lead): JobStage {
  const dbStage = (lead as Lead & { job_stage?: string | null }).job_stage;
  if (dbStage && (["scheduled","in_progress","punch_list","complete","invoiced"] as const).includes(dbStage as JobStage)) {
    return dbStage as JobStage;
  }
  if (!lead.notes) return "scheduled";
  try {
    const parsed = JSON.parse(lead.notes.split("\n")[0]);
    return (parsed.job_stage as JobStage) ?? "scheduled";
  } catch {
    return "scheduled";
  }
}

function getOwnerDisplay(lead: Lead): string {
  if (lead.owner_name) return lead.owner_name;
  const parts = [lead.owner_first, lead.owner_last].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "";
}

function JobCard({ lead, onMoveStage, isMoving }: {
  lead: Lead;
  onMoveStage: (lead: Lead, stage: JobStage) => void;
  isMoving: boolean;
}) {
  const stages: JobStage[] = ["scheduled", "in_progress", "punch_list", "complete", "invoiced"];
  const currentStage = getJobStage(lead);
  const currentIdx = stages.indexOf(currentStage);
  const nextStage = stages[currentIdx + 1] as JobStage | undefined;
  const trade = lead.trade ?? null;
  const badge = trade ? tradeBadgeColors(trade) : null;
  const ownerDisplay = getOwnerDisplay(lead);
  const cityState = [lead.city, lead.state].filter(Boolean).join(", ");

  return (
    <Card className="p-3 space-y-2">
      {/* Address */}
      <p className="text-sm font-semibold text-foreground line-clamp-1">{lead.address}</p>

      {/* City/State */}
      {cityState && (
        <p className="text-[11px] text-muted-foreground -mt-1">{cityState}</p>
      )}

      {/* Trade badge + permit number */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {badge && trade && (
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize", badge.bg, badge.text)}>
            {trade}
          </span>
        )}
        {lead.permit_id && (
          <span className="text-[10px] font-mono text-muted-foreground bg-[rgba(107,114,128,0.08)] px-1.5 py-0.5 rounded">
            {lead.permit_id}
          </span>
        )}
      </div>

      {/* Permit description */}
      {lead.permit_description && (
        <p className="text-[11px] text-muted-foreground line-clamp-1">
          {lead.permit_description}
        </p>
      )}

      {/* Value */}
      <p className="text-xs font-medium text-foreground">
        {formatCurrency(lead.pipeline_value ?? lead.permit_value ?? 0)}
      </p>

      {/* Filed date + owner */}
      <div className="flex items-center justify-between text-[11px] text-fg-subtle">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {lead.permit_age_days != null
            ? `Filed ${lead.permit_age_days}d ago`
            : "Filed date unknown"}
        </span>
        {ownerDisplay && (
          <span className="truncate max-w-[90px]">{ownerDisplay}</span>
        )}
      </div>

      {nextStage && (
        <button
          onClick={() => onMoveStage(lead, nextStage)}
          disabled={isMoving}
          className="w-full text-xs py-1 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {isMoving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Move to {JOB_COLUMNS.find((c) => c.id === nextStage)?.label}
        </button>
      )}
    </Card>
  );
}

function ColSkeleton() {
  return (
    <div className="w-[240px] shrink-0 bg-bg-subtle rounded-xl">
      <div className="px-3 py-2.5 border-b border-border">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32 mt-1" />
      </div>
      <div className="p-2 space-y-2">
        {[...Array(2)].map((_, i) => (
          <Card key={i} className="p-3 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-6 pt-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i} className="p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-12" />
        </Card>
      ))}
    </div>
  );
}

export default function JobsPage() {
  const { data: leads, isLoading } = useLeads({ filters: { status: ["won"] } });
  const updateStatus = useUpdateLeadStatus();
  const [movingId, setMovingId] = useState<string | null>(null);

  const grouped = useMemo<Record<JobStage, Lead[]>>(() => {
    const groups: Record<JobStage, Lead[]> = {
      scheduled: [], in_progress: [], punch_list: [], complete: [], invoiced: [],
    };
    for (const lead of leads ?? []) {
      const stage = getJobStage(lead);
      groups[stage].push(lead);
    }
    return groups;
  }, [leads]);

  async function handleMoveStage(lead: Lead, nextStage: JobStage) {
    setMovingId(lead.id);
    // Phase 2.1: write the new stage to the dedicated `job_stage` column
    // (one migration in `supabase/manual-apply-phase1.sql`) AND strip any
    // legacy `{"job_stage":"…"}` JSON prefix out of notes so old data
    // doesn't keep shadowing the column. New rows won't have the prefix.
    const existingNotes = lead.notes ?? "";
    let cleanNotes = existingNotes;
    try {
      JSON.parse(existingNotes.split("\n")[0]);
      cleanNotes = existingNotes.split("\n").slice(1).join("\n");
    } catch {
      /* no legacy prefix — keep notes as-is */
    }

    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase
      .from("leads")
      .update({ job_stage: nextStage, notes: cleanNotes || null })
      .eq("id", lead.id);

    // Invalidate leads cache via updateStatus (status stays 'won').
    await updateStatus.mutateAsync({
      leadId: lead.id,
      update: { status: "won" as LeadStatus, notes: cleanNotes || undefined },
    });
    setMovingId(null);
  }

  const totalJobs = (leads ?? []).length;
  const inProgressCount = (grouped.in_progress ?? []).length;
  const completeCount = (grouped.complete ?? []).length + (grouped.invoiced ?? []).length;
  const totalRevenue = (leads ?? []).reduce((sum, l) => sum + (l.pipeline_value ?? l.permit_value ?? 0), 0);

  const stats = [
    { label: "Total Jobs", value: totalJobs.toString() },
    { label: "In Progress", value: inProgressCount.toString() },
    { label: "Complete", value: completeCount.toString() },
    { label: "Total Revenue", value: formatCurrency(totalRevenue) },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-2xl font-heading font-normal text-foreground">Active Jobs</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Won leads tracked through delivery</p>
        </div>
      </div>

      {/* Stats Row */}
      {isLoading ? (
        <StatsSkeleton />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-6 pt-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-heading font-normal text-foreground mt-1">{stat.value}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {isLoading
            ? JOB_COLUMNS.map((col) => <ColSkeleton key={col.id} />)
            : JOB_COLUMNS.map((col) => {
                const colLeads = grouped[col.id] ?? [];
                return (
                  <div key={col.id} className="w-[240px] shrink-0 flex flex-col bg-bg-subtle rounded-xl">
                    <div className="px-3 py-2.5 border-b border-border shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: col.dotColor }} />
                        <span className="text-sm font-semibold text-foreground">{col.label}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{colLeads.length}</span>
                      </div>
                      <p className="text-[11px] text-fg-subtle mt-0.5">{col.description}</p>
                    </div>
                    <div className={cn("flex-1 overflow-y-auto p-2 space-y-2")}>
                      {colLeads.length === 0 ? (
                        <div className="h-12 flex items-center justify-center text-xs text-muted-foreground border-2 border-dashed border-border rounded-lg">
                          Empty
                        </div>
                      ) : (
                        colLeads.map((lead) => (
                          <JobCard
                            key={lead.id}
                            lead={lead}
                            onMoveStage={handleMoveStage}
                            isMoving={movingId === lead.id}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}
