"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Plus, Loader2, CalendarDays } from "lucide-react";
import { useLeads, useUpdateLeadStatus } from "@/hooks/useLeads";
import { STAGE_LABEL_MAP } from "@/lib/intent/stage-colors";
import { formatCurrency } from "@/types/lead";
import type { Lead, LeadStatus } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";
import { AddLeadDialog } from "@/components/dashboard/AddLeadDialog";
import { ExclusivityBadge } from "@/components/dashboard/ExclusivityBadge";
import { WatchersBadge } from "@/components/dashboard/WatchersBadge";
import { useExclusivity } from "@/hooks/useExclusivity";
import type { ExclusivityLeadSummary } from "@/lib/exclusivity/locks";

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
  /* Module 23 (2026-05-09) — intent classification surfaces on the
   * kanban card. Tints the card's left border + adds a stage chip
   * alongside the trade chip. */
  opportunityStage?: string | null;
}

interface KanbanColumnDef {
  id: LeadStatus;
  label: string;
  color: string;
  dotColor: string;
}

/* Status column colours — sourced from semantic CSS tokens so the palette
 * propagates from globals.css. `dotColor` is a string fed to inline
 * `style={{ background: col.dotColor }}`; both `var(--hot)` and
 * `hsl(var(--success))` resolve at the CSS layer. The `quoted` purple and
 * `archived` grey have no semantic token (no `--purple`/`--neutral` in the
 * brand palette) so they stay as hex literals — when the brand adds
 * those, swap them in here in one place. Migrated from raw hex on
 * 2026-04-25 per design-system audit priority action #4. */
const COLUMNS: KanbanColumnDef[] = [
  { id: "new",       label: "New",       color: "bg-primary-10",                                                  dotColor: "var(--hot)" },
  { id: "contacted", label: "Contacted", color: "bg-[color-mix(in_srgb,var(--warm)_10%,transparent)]",            dotColor: "var(--warm)" },
  { id: "quoted",    label: "Quoted",    color: "bg-[rgba(139,92,246,0.10)]",                                     dotColor: "#8B5CF6" },
  { id: "proposal",  label: "Proposal",  color: "bg-[color-mix(in_srgb,var(--cool)_10%,transparent)]",            dotColor: "var(--cool)" },
  { id: "won",       label: "Won",       color: "bg-[color-mix(in_srgb,hsl(var(--success))_10%,transparent)]",    dotColor: "hsl(var(--success))" },
  { id: "lost",      label: "Lost",      color: "bg-[color-mix(in_srgb,hsl(var(--destructive))_10%,transparent)]", dotColor: "hsl(var(--destructive))" },
  { id: "archived",  label: "Archived",  color: "bg-muted/30",                                                    dotColor: "#6B7280" },
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
    opportunityStage: lead.opportunity_stage ?? null,
  };
}

/* Score-tier colour pill — uses the canonical `--hot`/`--warm`/`--cool`
 * tokens so the palette propagates from globals.css. Same pattern as
 * LeadCard's `scoreColor()` (lines 99-101). */
function scoreColor(score: number) {
  if (score >= 75) return "text-hot  bg-[color-mix(in_srgb,var(--hot)_12%,transparent)]";
  if (score >= 50) return "text-warm bg-[color-mix(in_srgb,var(--warm)_12%,transparent)]";
  return "text-cool bg-[color-mix(in_srgb,var(--cool)_12%,transparent)]";
}

/* Trade pill colours — every Henri trade slug has a matching `--trade-*-fg`
 * (text) + `--trade-*-tint` (bg) token defined in globals.css, so consumers
 * just pick the slug. The "general remodel" badge uses the `general` trade
 * tokens; `solar` keeps its slug as `solar` (no orange-ambar token, the
 * `--trade-solar-*` pair handles it). Migrated from raw hex on 2026-04-25. */
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

/** Red <3 days, yellow 3-10, grey older */
function urgencyDotColor(days: number | undefined): string {
  if (days === undefined) return "#9CA3AF";
  if (days < 3) return "#EF4444";
  if (days <= 10) return "#F59E0B";
  return "#9CA3AF";
}

// Module 23 — stage palette resolver. Imported once at module scope so
// the KanbanCard component can short-circuit when a lead has no stage.
import { paletteFor } from "@/lib/intent/stage-colors";

function KanbanCard({
  lead,
  onDragStart,
  isUpdating,
  exclusivity,
  isDragging,
}: {
  lead: KanbanLead;
  onDragStart: (e: React.DragEvent, lead: KanbanLead) => void;
  isUpdating?: boolean;
  /** Phase 0a exclusivity summary: lock countdown (when caller holds it)
   *  + coarse watcher bucket (wedge #6 competitive intel). Either/both
   *  badges may render; badge code no-ops when not applicable. */
  exclusivity?: ExclusivityLeadSummary | null;
  /** True when this card is the source of an active drag. Hides the
   *  source while the drag preview floats with the cursor — fixes the
   *  "ghost duplicate" perception flagged in the 2026-04-26 audit. */
  isDragging?: boolean;
}) {
  const badge = lead.trade ? tradeBadgeColors(lead.trade) : null;
  const urgencyColor = urgencyDotColor(lead.permitAgeDays);
  // Module 23 — stage palette for the kanban card. Tint the left border +
  // emit a stage chip in row 2 alongside the trade pill. Falls through
  // gracefully when the lead hasn't been classified yet.
  const stagePalette = paletteFor(lead.opportunityStage);

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
      onDragStart={(e) => {
        // Set drag-data so the browser fires native dragend events even
        // when the drop target is the same column. Without setData, some
        // browsers cancel the drag silently and the card looks duplicated.
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(e, lead);
      }}
      style={
        // Module 23 — left-stripe tint matching the stage palette. We
        // override the existing border-left color via inline style so a
        // missing palette doesn't strip the default border-l-border class.
        stagePalette
          ? { borderLeftWidth: "3px", borderLeftColor: stagePalette.color }
          : undefined
      }
      className={cn(
        "bg-card border border-border rounded-xl p-3 transition-shadow",
        isUpdating ? "opacity-50 cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:shadow-md",
        // Hide the source card while a drag is in flight. The browser's
        // ghost-image floats with the cursor; if the source stays
        // visible the user perceives a duplicate. Visibility, not
        // display:none, so layout doesn't reflow.
        isDragging && "opacity-0 pointer-events-none"
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

      {/* Row 2: Stage chip + trade badge + permit number + exclusivity */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <ExclusivityBadge summary={exclusivity} size="xs" />
        <WatchersBadge bucket={exclusivity?.watchers_bucket} size="xs" />
        {/* Module 23 — intent stage chip. Same palette as drawer chip,
            map pin, and LeadCard left-border. Renders only when the
            classifier has stamped the row (no chip = pre-backfill). */}
        {stagePalette && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-tight"
            style={{
              backgroundColor: `${stagePalette.color}1A`,
              color: stagePalette.color,
              border: `1px solid ${stagePalette.color}66`,
            }}
            title={stagePalette.label}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: stagePalette.color }}
            />
            {stagePalette.label}
          </span>
        )}
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

  // Module 8 — `?stage=` URL filter. Restricts the kanban to leads
  // whose opportunity_stage matches; "all" / missing param = show
  // everything. The dropdown writes the URL via router.replace so
  // the value survives reload + share-able links.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stageFilter = searchParams.get("stage") ?? "all";

  const setStageFilter = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") {
        params.delete("stage");
      } else {
        params.set("stage", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  // Group leads into columns
  const pipeline = useMemo<Record<string, KanbanLead[]>>(() => {
    const groups: Record<string, KanbanLead[]> = {
      new: [], contacted: [], quoted: [], proposal: [], won: [], lost: [], archived: [],
    };
    const filtered = (leads ?? []).filter((l) => {
      if (stageFilter === "all") return true;
      return l.opportunity_stage === stageFilter;
    });
    for (const lead of filtered) {
      const mapped = mapLeadToKanban(lead);
      if (groups[mapped.status]) {
        groups[mapped.status].push(mapped);
      } else {
        groups.new.push(mapped);
      }
    }
    return groups;
  }, [leads, stageFilter]);

  const handleDragStart = useCallback((e: React.DragEvent, lead: KanbanLead, fromCol: string) => {
    setDraggedLead({ lead, fromCol });
    e.dataTransfer.effectAllowed = "move";
    /* Stash the lead identity on the native dataTransfer payload so the
     * drop handler can recover it even if the React `draggedLead` state
     * has already been cleared by a `dragend` event that fired before
     * `drop` (browsers don't guarantee fire order on fast releases).
     * Pre-04-30 the drop handler relied on state alone and silently
     * no-op'd when the race lost — leads occasionally refused to move.
     * Native dataTransfer survives the dragend cleanup. */
    try {
      e.dataTransfer.setData(
        "application/x-henri-lead",
        JSON.stringify({ leadId: lead.id, fromCol })
      );
    } catch {
      /* Some browsers (older Safari) reject custom MIME types; the
       * "text/plain" fallback set in KanbanCard.onDragStart still gives
       * us the lead id, and we'll fall back to React state for fromCol. */
    }
  }, []);

  // Clear `draggedLead` when the user releases outside any column. Without
  // this, the source card stays opacity-0 after a cancelled drag and the
  // user has to refresh to see it again. Window-level dragend fires for
  // every drag regardless of where the drop happens.
  useEffect(() => {
    if (!draggedLead) return;
    const onEnd = () => setDraggedLead(null);
    window.addEventListener("dragend", onEnd);
    return () => window.removeEventListener("dragend", onEnd);
  }, [draggedLead]);

  const handleDrop = useCallback(async (e: React.DragEvent, toCol: string) => {
    /* Recover lead identity from dataTransfer first — it survives even
     * if the dragend listener already nulled out `draggedLead` state.
     * Fall back to state if dataTransfer is empty (older browsers). */
    let leadId: string | undefined;
    let fromCol: string | undefined;
    try {
      const raw = e.dataTransfer.getData("application/x-henri-lead");
      if (raw) {
        const parsed = JSON.parse(raw) as { leadId?: string; fromCol?: string };
        if (parsed?.leadId) leadId = parsed.leadId;
        if (parsed?.fromCol) fromCol = parsed.fromCol;
      }
    } catch {
      /* Unparseable payload — fall through to React state below. */
    }
    if (!leadId && draggedLead) {
      leadId = draggedLead.lead.id;
      fromCol = draggedLead.fromCol;
    }
    setDraggedLead(null);
    if (!leadId || !fromCol) return;
    if (fromCol === toCol) return;

    const id = leadId;
    setUpdatingIds((prev) => new Set(prev).add(id));
    try {
      await updateStatus.mutateAsync({
        leadId: id,
        update: { status: toCol as LeadStatus },
      });
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
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
        <div className="flex items-center gap-2">
          {/* Module 8 — stage filter (URL-driven) */}
          <label className="text-xs text-muted-foreground" htmlFor="kanban-stage-filter">
            Stage
          </label>
          <select
            id="kanban-stage-filter"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All stages</option>
            {Object.entries(STAGE_LABEL_MAP).map(([slug, label]) => (
              <option key={slug} value={slug}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => setAddDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            Add lead
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-w-max">
          {isLoading
            ? COLUMNS.map((col) => <ColumnSkeleton key={col.id} />)
            : COLUMNS.map((col) => {
                const colLeads = pipeline[col.id] ?? [];
                const colTotal = colLeads.reduce((s, l) => s + l.rawValue, 0);
                // Module 25 (2026-05-09) — stage mix per column. Aggregate
                // the column's leads by opportunity_stage and surface the
                // top 3 as colored dots in the column header so the
                // contractor can see their funnel composition without
                // expanding cards.
                const stageMix = (() => {
                  const map = new Map<string, number>();
                  for (const l of colLeads) {
                    if (!l.opportunityStage) continue;
                    map.set(l.opportunityStage, (map.get(l.opportunityStage) ?? 0) + 1);
                  }
                  return Array.from(map.entries())
                    .map(([stage, n]) => ({ stage, n, palette: paletteFor(stage) }))
                    .filter((s) => s.palette !== null)
                    .sort((a, b) => b.n - a.n);
                })();
                return (
                  <div
                    key={col.id}
                    className="w-[270px] shrink-0 flex flex-col bg-bg-subtle rounded-xl"
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => handleDrop(e, col.id)}
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
                      {/* Module 25 — stage-mix dots row. Renders only when
                          ≥1 lead in the column has been classified. */}
                      {stageMix.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5" aria-label="Stage mix">
                          {stageMix.slice(0, 3).map((s) => (
                            s.palette && (
                              <span
                                key={s.stage}
                                className="inline-flex items-center gap-1 text-[10px] text-fg-subtle"
                                title={`${s.palette.label}: ${s.n}`}
                              >
                                <span
                                  className="inline-block w-1.5 h-1.5 rounded-full"
                                  style={{ background: s.palette.color }}
                                />
                                <span>{s.n}</span>
                              </span>
                            )
                          ))}
                          {stageMix.length > 3 && (
                            <span className="text-[10px] text-fg-subtle/70">+{stageMix.length - 3}</span>
                          )}
                        </div>
                      )}
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
                            isDragging={draggedLead?.lead.id === lead.id}
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
