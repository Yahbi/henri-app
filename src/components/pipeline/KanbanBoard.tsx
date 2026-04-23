"use client";

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { Plus, Loader2, CalendarDays } from "lucide-react";
import { useLeads, useUpdateLeadStatus } from "@/hooks/useLeads";
import { formatCurrency } from "@/types/lead";
import type { Lead, LeadStatus } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";
import { AddLeadDialog } from "@/components/dashboard/AddLeadDialog";
import { ExclusivityBadge } from "@/components/dashboard/ExclusivityBadge";
import { useExclusivity } from "@/hooks/useExclusivity";
import type { ExclusivityLockSummary } from "@/lib/exclusivity/locks";

interface KanbanLead {
  id: string;
  addr: string;
  type: string;
  value: string;
  rawValue: number;
  score: number;
  owner: string;
  zip: string;
  daysInStage: number;
  notes?: string;
  status: LeadStatus;
  permitId?: string;
  permitDescription?: string;
  trade?: string;
  permitAgeDays?: number;
  city?: string;
  state?: string;
  /* Enrichment fields — used by the card tooltip so sales reps can
   * see property context on hover without opening the detail drawer. */
  yearBuilt?: number;
  homeSqft?: string | number;
  assessedValue?: number;
}

interface KanbanColumnDef {
  id: LeadStatus;
  label: string;
  color: string;
  dotColor: string;
}

const COLUMNS: KanbanColumnDef[] = [
  { id: "new", label: "New", color: "bg-primary-10", dotColor: "#D4886A" },
  { id: "contacted", label: "Contacted", color: "bg-[rgba(212,162,74,0.10)]", dotColor: "#D4A24A" },
  { id: "quoted", label: "Quoted", color: "bg-[rgba(139,92,246,0.10)]", dotColor: "#8B5CF6" },
  { id: "proposal", label: "Proposal", color: "bg-[rgba(74,127,192,0.10)]", dotColor: "#4A7FC0" },
  { id: "won", label: "Won", color: "bg-[rgba(61,153,112,0.10)]", dotColor: "#3D9970" },
  { id: "lost", label: "Lost", color: "bg-[rgba(192,80,60,0.10)]", dotColor: "#C0503C" },
  { id: "archived", label: "Archived", color: "bg-muted/30", dotColor: "#6B7280" },
];

/** Industry-default win probabilities per pipeline stage. These are the
 * priors used when the contractor has no historical data yet. Once they
 * have a meaningful sample of closed-won + closed-lost leads, we derive
 * per-stage conversion from their own funnel via computeWinProbs() below. */
const DEFAULT_WIN_PROBS: Record<string, string> = {
  new: "5%", contacted: "15%", quoted: "30%", proposal: "40%", won: "100%", lost: "0%", archived: "0%",
};

/** Derive win probability per stage from the contractor's actual pipeline.
 *  Each stage's probability = (won leads that passed through this stage) /
 *  (total leads currently at or past this stage). Returns the defaults
 *  when sample size is too low (< 10 total leads or 0 wins). */
function computeWinProbs(leads: Array<{ status: string }>): Record<string, string> {
  if (!leads || leads.length < 10) return DEFAULT_WIN_PROBS;
  const counts: Record<string, number> = {
    new: 0, contacted: 0, quoted: 0, proposal: 0, won: 0, lost: 0, archived: 0,
  };
  for (const l of leads) counts[l.status] = (counts[l.status] ?? 0) + 1;
  const won = counts.won;
  if (won === 0) return DEFAULT_WIN_PROBS;
  // Each stage total = leads currently at that stage OR downstream (won).
  // A lead that's currently "quoted" has already passed "contacted".
  const newAndBeyond = counts.new + counts.contacted + counts.quoted + counts.proposal + counts.won;
  const contactedAndBeyond = counts.contacted + counts.quoted + counts.proposal + counts.won;
  const quotedAndBeyond = counts.quoted + counts.proposal + counts.won;
  const proposalAndBeyond = counts.proposal + counts.won;
  const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");
  return {
    new: pct(won, newAndBeyond),
    contacted: pct(won, contactedAndBeyond),
    quoted: pct(won, quotedAndBeyond),
    proposal: pct(won, proposalAndBeyond),
    won: "100%",
    lost: "0%",
  };
}

function mapLeadToKanban(lead: Lead): KanbanLead {
  const rawValue = lead.pipeline_value ?? lead.permit_value ?? 0;
  const daysInStage = lead.permit_age_days ?? 0;
  return {
    id: lead.id,
    addr: lead.address ?? "Unknown",
    type: lead.permit_type ?? lead.trade ?? "Permit",
    value: formatCurrency(rawValue),
    rawValue,
    score: lead.score,
    owner: lead.owner_name ?? [lead.owner_first, lead.owner_last].filter(Boolean).join(" ") ?? "",
    zip: lead.zip ?? "",
    daysInStage,
    notes: lead.notes ?? undefined,
    status: lead.status,
    permitId: lead.permit_id ?? undefined,
    permitDescription: lead.permit_description ?? undefined,
    trade: lead.trade ?? undefined,
    permitAgeDays: lead.permit_age_days ?? undefined,
    city: lead.city ?? undefined,
    state: lead.state ?? undefined,
    // Enrichment passthrough for card tooltip.
    yearBuilt: lead.year_built ?? undefined,
    homeSqft: lead.home_sqft ?? undefined,
    assessedValue: lead.assessed_value ?? undefined,
  };
}

function scoreColor(score: number) {
  if (score >= 75) return "text-[#D4886A] bg-[rgba(212,136,106,0.12)]";
  if (score >= 50) return "text-[#D4A24A] bg-[rgba(212,162,74,0.12)]";
  return "text-[#4A7FC0] bg-[rgba(74,127,192,0.12)]";
}

const TRADE_COLORS: Record<string, { bg: string; text: string }> = {
  roofing:          { bg: "bg-[rgba(212,136,106,0.15)]", text: "text-[#D4886A]" },
  hvac:             { bg: "bg-[rgba(74,127,192,0.15)]",  text: "text-[#4A7FC0]" },
  plumbing:         { bg: "bg-[rgba(61,153,112,0.15)]",  text: "text-[#3D9970]" },
  electrical:       { bg: "bg-[rgba(212,162,74,0.15)]",  text: "text-[#D4A24A]" },
  solar:            { bg: "bg-[rgba(245,166,35,0.15)]",  text: "text-[#F5A623]" },
  adu:              { bg: "bg-[rgba(139,92,246,0.15)]",   text: "text-[#8B5CF6]" },
  "general remodel":{ bg: "bg-[rgba(107,114,128,0.15)]", text: "text-[#6B7280]" },
};

function tradeBadgeColors(trade: string): { bg: string; text: string } {
  const key = trade.toLowerCase();
  return TRADE_COLORS[key] ?? { bg: "bg-[rgba(107,114,128,0.12)]", text: "text-[#6B7280]" };
}

/** Red <3 days, yellow 3-10, grey older */
function urgencyDotColor(days: number | undefined): string {
  if (days === undefined) return "#9CA3AF";
  if (days < 3) return "#EF4444";
  if (days <= 10) return "#F59E0B";
  return "#9CA3AF";
}

function KanbanCard({
  lead,
  onDragStart,
  isUpdating,
  exclusivity,
}: {
  lead: KanbanLead;
  onDragStart: (e: React.DragEvent, lead: KanbanLead) => void;
  isUpdating?: boolean;
  /** Phase 0a exclusivity lock summary. Badge shows countdown when the
   *  current contractor holds the lock; never rendered otherwise. */
  exclusivity?: ExclusivityLockSummary | null;
}) {
  const badge = lead.trade ? tradeBadgeColors(lead.trade) : null;
  const urgencyColor = urgencyDotColor(lead.permitAgeDays);

  // Tooltip shown on card hover (native `title` attr, no library). Surfaces
  // the enrichment data so reps can triage without opening the drawer.
  const tooltipLines: string[] = [];
  if (lead.owner) tooltipLines.push(`Owner: ${lead.owner}`);
  if (lead.yearBuilt) tooltipLines.push(`Year built: ${lead.yearBuilt}`);
  if (lead.homeSqft) tooltipLines.push(`Home: ${Number(lead.homeSqft).toLocaleString()} sqft`);
  if (lead.assessedValue) tooltipLines.push(`Assessed: ${formatCurrency(lead.assessedValue)}`);
  if (lead.notes) tooltipLines.push(`Notes: ${lead.notes}`);
  const cardTooltip = tooltipLines.join("\n") || undefined;

  return (
    <div
      title={cardTooltip}
      draggable={!isUpdating}
      onDragStart={(e) => onDragStart(e, lead)}
      className={cn(
        "bg-card border border-border rounded-xl p-3 transition-shadow",
        isUpdating ? "opacity-50 cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:shadow-md"
      )}
    >
      {/* Row 1: Address + score badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {/* Urgency dot */}
            <span
              className="shrink-0 w-2 h-2 rounded-full"
              style={{ background: urgencyColor }}
              title={
                lead.permitAgeDays !== undefined
                  ? lead.permitAgeDays < 3
                    ? "Filed within 3 days"
                    : lead.permitAgeDays <= 10
                    ? "Filed 3-10 days ago"
                    : "Filed over 10 days ago"
                  : "Unknown age"
              }
            />
            <p className="text-sm font-semibold text-foreground truncate">{lead.addr}</p>
          </div>
          {/* City / State */}
          {(lead.city || lead.state) && (
            <p className="text-[11px] text-muted-foreground mt-0.5 ml-3.5">
              {[lead.city, lead.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        <div className={cn("shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold", scoreColor(lead.score))}>
          {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : lead.score}
        </div>
      </div>

      {/* Row 2: Trade badge + permit number + exclusivity countdown */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <ExclusivityBadge summary={exclusivity} size="xs" />
        {badge && lead.trade && (
          <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize", badge.bg, badge.text)}>
            {lead.trade}
          </span>
        )}
        {lead.permitId && (
          <span className="text-[10px] font-mono text-muted-foreground bg-[rgba(107,114,128,0.08)] px-1.5 py-0.5 rounded">
            {lead.permitId}
          </span>
        )}
      </div>

      {/* Row 3: Permit description snippet */}
      {lead.permitDescription && (
        <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-1">
          {lead.permitDescription}
        </p>
      )}

      {/* Row 4: Value + ZIP */}
      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        <span className="font-medium">{lead.value}</span>
        <span>ZIP {lead.zip}</span>
      </div>

      {/* Row 5: Filed date + owner */}
      <div className="flex items-center justify-between mt-2 text-[11px] text-fg-subtle">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {lead.permitAgeDays !== undefined
            ? `Filed ${lead.permitAgeDays}d ago`
            : `${lead.daysInStage}d in stage`}
        </span>
        {lead.owner && <span className="truncate max-w-[80px]">{lead.owner}</span>}
      </div>

      {/* Notes (if any) */}
      {lead.notes && (
        <p className="text-[11px] text-fg-subtle mt-1.5 line-clamp-2">{lead.notes}</p>
      )}
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="w-[270px] shrink-0 flex flex-col bg-bg-subtle rounded-xl">
      <div className="px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Skeleton className="w-2.5 h-2.5 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-3 w-24 mt-1" />
      </div>
      <div className="flex-1 p-2 space-y-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-3 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  const { data: leads, isLoading } = useLeads();
  const updateStatus = useUpdateLeadStatus();
  const [draggedLead, setDraggedLead] = useState<{ lead: KanbanLead; fromCol: string } | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Phase 0a — exclusivity lock summaries. When migration 00031 isn't
  // applied the map is empty and no badge renders. When the scorer has
  // acquired locks for the contractor, the Kanban card shows the
  // countdown pill matching what Leads-list rows show.
  const leadIdsForLocks = useMemo(() => (leads ?? []).map((l) => l.id), [leads]);
  const { locks } = useExclusivity(leadIdsForLocks);

  // Replace the static WIN_PROBS with a data-driven version once the
  // contractor has enough closed leads to compute real conversion rates.
  const winProbs = useMemo(
    () => computeWinProbs((leads ?? []).map((l) => ({ status: l.status }))),
    [leads],
  );

  // Group leads into columns
  const pipeline = useMemo<Record<string, KanbanLead[]>>(() => {
    const groups: Record<string, KanbanLead[]> = {
      new: [], contacted: [], quoted: [], proposal: [], won: [], lost: [], archived: [],
    };
    for (const lead of leads ?? []) {
      const mapped = mapLeadToKanban(lead);
      if (groups[mapped.status]) {
        groups[mapped.status].push(mapped);
      } else {
        groups.new.push(mapped);
      }
    }
    return groups;
  }, [leads]);

  const handleDragStart = useCallback((e: React.DragEvent, lead: KanbanLead, fromCol: string) => {
    setDraggedLead({ lead, fromCol });
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(async (toCol: string) => {
    if (!draggedLead) return;
    const { lead, fromCol } = draggedLead;
    setDraggedLead(null);
    if (fromCol === toCol) return;

    setUpdatingIds((prev) => new Set(prev).add(lead.id));
    try {
      await updateStatus.mutateAsync({
        leadId: lead.id,
        update: { status: toCol as LeadStatus },
      });
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }, [draggedLead, updateStatus]);

  // Weighted pipeline value
  const weights: Record<string, number> = { new: 0.05, contacted: 0.15, quoted: 0.3, proposal: 0.4, won: 1, lost: 0, archived: 0 };
  const weightedTotal = Object.entries(pipeline).reduce((sum, [col, colLeads]) => {
    return sum + colLeads.reduce((s, l) => s + l.rawValue * (weights[col] ?? 0), 0);
  }, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Pipeline &mdash;{" "}
            <span className="text-primary">{formatCurrency(Math.round(weightedTotal))}</span> weighted value
          </h1>
        </div>
        <button
          onClick={() => setAddDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          Add lead
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {isLoading
            ? COLUMNS.map((col) => <ColumnSkeleton key={col.id} />)
            : COLUMNS.map((col) => {
                const colLeads = pipeline[col.id] ?? [];
                const colTotal = colLeads.reduce((s, l) => s + l.rawValue, 0);
                return (
                  <div
                    key={col.id}
                    className="w-[270px] shrink-0 flex flex-col bg-bg-subtle rounded-xl"
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={() => handleDrop(col.id)}
                  >
                    {/* Column header */}
                    <div className="px-3 py-2.5 border-b border-border shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.dotColor }} />
                        <span className="text-sm font-semibold text-foreground">{col.label}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{colLeads.length}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-fg-subtle">
                        <span>{formatCurrency(colTotal)}</span>
                        <span>&middot;</span>
                        <span>{winProbs[col.id]} win prob</span>
                      </div>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {colLeads.length === 0 ? (
                        <div className="h-16 flex items-center justify-center border-2 border-dashed border-border rounded-lg text-xs text-muted-foreground">
                          Drop here
                        </div>
                      ) : (
                        colLeads.map((lead) => (
                          <KanbanCard
                            key={lead.id}
                            lead={lead}
                            onDragStart={(e) => handleDragStart(e, lead, col.id)}
                            isUpdating={updatingIds.has(lead.id)}
                            exclusivity={locks[lead.id]}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>

      <AddLeadDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} />
    </div>
  );
}
