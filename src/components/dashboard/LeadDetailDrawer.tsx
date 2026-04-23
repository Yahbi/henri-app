"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import {
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Hash,
  Zap,
  Clock,
  TrendingUp,
  Target,
  AlertTriangle,
  Home,
  Ruler,
  User,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useEnrichment } from "@/hooks/useEnrichment";
import { usePermitHistory } from "@/hooks/usePermitHistory";
import { FocusTrap } from "@/components/ui/focus-trap";
import { ScoreSignalBreakdown } from "./ScoreSignalBreakdown";
import { PermitTimeline } from "./PermitTimeline";
import { PermitHistorySection } from "./PermitHistorySection";
import type { LeadData } from "./LeadCard";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function scoreColor(score: number) {
  if (score >= 75) return "text-hot border-hot";
  if (score >= 50) return "text-warm border-warm";
  return "text-cool border-cool";
}

function scoreLabel(score: number) {
  if (score >= 75) return "Hot Lead";
  if (score >= 50) return "Warm Lead";
  if (score >= 25) return "Cool Lead";
  return "Cold Lead";
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "---";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "---";
  }
}

/* ── Predictive proposal generator ───────────────────────────────────── */

interface Proposal {
  headline: string;
  insight: string;
  urgency: "high" | "medium" | "low";
  actions: string[];
  window: string;
  estimatedRevenue: string | null;
}

function generateProposal(lead: LeadData): Proposal {
  const trade = (lead.trade ?? "other").toLowerCase();
  const age = lead.permitAge ?? 0;
  const value = lead.value;
  const desc = (lead.permitDescription ?? "").toLowerCase();

  // Urgency based on permit age
  const urgency: Proposal["urgency"] =
    age <= 3 ? "high" : age <= 10 ? "medium" : "low";

  // Window estimate
  const window =
    age <= 2
      ? "48 hours — first-mover advantage"
      : age <= 7
        ? `${7 - age} days before competitive saturation`
        : "Follow up promptly — other contractors may have reached out";

  // Revenue estimate from permit value
  let estimatedRevenue: string | null = null;
  const rawVal = parseFloat(value?.replace(/[$K,M]/g, "") ?? "0");
  if (value?.includes("M")) {
    estimatedRevenue = `$${(rawVal * 0.15).toFixed(0)}K - $${(rawVal * 0.25).toFixed(0)}K contractor revenue`;
  } else if (value?.includes("K") && rawVal > 5) {
    const low = Math.round(rawVal * 0.4);
    const high = Math.round(rawVal * 0.7);
    estimatedRevenue = `$${low}K - $${high}K estimated contract value`;
  }

  // Trade-specific proposals
  const proposals: Record<string, { headline: string; insight: string; actions: string[] }> = {
    roofing: {
      headline: "Roof project — high-conversion opportunity",
      insight: desc.includes("replacement")
        ? "Full roof replacement permits have a 35% close rate when contacted within 72 hours. Property owner is actively sourcing bids."
        : "Roof repair permits often expand in scope once inspection reveals additional damage. Offer a free inspection to uncover the full opportunity.",
      actions: [
        "Call within 24 hours to schedule a free estimate",
        "Prepare material cost comparison (shingle vs. tile vs. metal)",
        "Mention manufacturer warranty options to differentiate your bid",
      ],
    },
    hvac: {
      headline: "HVAC system permit — seasonal urgency",
      insight: desc.includes("replacement")
        ? "System replacements are time-sensitive. The homeowner is without full heating/cooling and will choose fast. Lead with availability and same-week install."
        : "HVAC work often leads to duct replacement, insulation, or thermostat upgrades. Offer a bundled package to increase ticket size.",
      actions: [
        "Emphasize quick turnaround and available install dates",
        "Prepare energy efficiency comparison for upsell",
        "Offer financing options for systems over $8K",
      ],
    },
    plumbing: {
      headline: "Plumbing permit — likely urgent need",
      insight: desc.includes("sewer") || desc.includes("repipe")
        ? "Whole-house plumbing work signals a committed homeowner. These projects rarely get cancelled and close at high rates."
        : "Plumbing repairs often indicate an aging home with upcoming renovation needs. Position yourself for the larger project pipeline.",
      actions: [
        "Respond within 24 hours — plumbing issues are urgent",
        "Offer a comprehensive inspection to identify other issues",
        "Provide a detailed estimate with material options",
      ],
    },
    electrical: {
      headline: "Electrical permit — modernization opportunity",
      insight: desc.includes("panel") || desc.includes("200")
        ? "Panel upgrades are often prerequisites for solar, EV chargers, or renovation. Ask about their broader plans to capture adjacent work."
        : "Electrical permits for rewiring signal a property in active renovation. There may be opportunities for additional trades.",
      actions: [
        "Ask about plans for solar, EV charging, or home automation",
        "Provide a safety inspection to identify code compliance issues",
        "Offer a package deal for panel + related electrical upgrades",
      ],
    },
    solar: {
      headline: "Solar installation — high-value, high-intent",
      insight:
        "Solar permit holders have already committed to the project and are comparing installers. Focus on timeline, warranty, and monitoring. These leads close at 40%+ when contacted within 48 hours.",
      actions: [
        "Lead with production estimates specific to their roof orientation",
        "Highlight battery storage add-on for increased value",
        "Provide utility rate analysis showing ROI timeline",
      ],
    },
    adu: {
      headline: "ADU construction — major project opportunity",
      insight:
        "Accessory dwelling units are high-value, multi-trade projects ($80K-$200K+). The permit holder needs GC coordination across foundation, framing, plumbing, electrical, and finishes.",
      actions: [
        "Offer a comprehensive build package or GC services",
        "Provide a detailed timeline with milestones",
        "Discuss financing options — many ADU builders use construction loans",
      ],
    },
    "general remodel": {
      headline: "Renovation project — multi-trade potential",
      insight: desc.includes("kitchen")
        ? "Kitchen remodels average $35K-$75K and often expand in scope. Position as a full-service renovation partner."
        : desc.includes("bathroom")
          ? "Bathroom remodels are high-margin projects with quick turnaround. Offer design-build to simplify the process for the homeowner."
          : "Renovation permits indicate an active property improvement cycle. Capture the full scope of work including trades the owner hasn't considered yet.",
      actions: [
        "Schedule an in-home consultation to understand the full vision",
        "Prepare a portfolio of similar completed projects",
        "Offer design assistance to increase project scope and value",
      ],
    },
  };

  const match = proposals[trade] ?? {
    headline: "New construction permit — active project",
    insight: `A ${lead.type ?? "construction"} permit was filed ${age} days ago. The property owner is in the planning phase and actively evaluating contractors. Early outreach significantly increases close rates.`,
    actions: [
      "Contact within 48 hours for first-mover advantage",
      "Prepare a detailed estimate based on permit scope",
      "Offer a site visit to assess conditions and refine pricing",
    ],
  };

  return {
    headline: match.headline,
    insight: match.insight,
    urgency,
    actions: match.actions,
    window,
    estimatedRevenue,
  };
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const MIN_HEIGHT = 140;
// Allow the banner to expand to 92% of the container height when the user
// drags it up. Prior 75% cap cut off content on short laptop screens.
const MAX_HEIGHT_RATIO = 0.92;

interface LeadDetailDrawerProps {
  lead: LeadData | null;
  onClose: () => void;
  height: number;
  onHeightChange: (h: number) => void;
}

export function LeadDetailDrawer({
  lead,
  onClose,
  height,
  onHeightChange,
}: LeadDetailDrawerProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local drag height — decoupled from parent state during active drag so
  // every pointer-move frame doesn't setState on the dashboard and force the
  // whole map/overlay tree to re-render. We only bubble the final height up
  // to the parent when the user releases the handle.
  // Clamp the initial value to >= MIN_HEIGHT so a stale parent value of 0
  // (set by a broken drag event) can't lock the drawer in a 0-height state.
  const [localHeight, setLocalHeight] = useState<number>(() =>
    Math.max(MIN_HEIGHT, height || MIN_HEIGHT),
  );

  // When the parent's `height` prop changes (e.g., programmatic reset), sync
  // it down — but only when we're NOT actively dragging, otherwise we'd
  // overwrite the user's live drag. Clamp to MIN_HEIGHT so a synthesized
  // pointer event that left dragging.current=true doesn't permanently
  // strand the drawer at 0 height on the next mount.
  useEffect(() => {
    if (!dragging.current) {
      setLocalHeight(Math.max(MIN_HEIGHT, height || MIN_HEIGHT));
    }
  }, [height]);

  // Safety valve: when a new lead is selected, force dragging.current back
  // to false. Without this, if a previous drag was interrupted (browser
  // lost pointer capture, script tab switched, etc.) the drawer would be
  // stuck ignoring height-prop updates forever.
  useEffect(() => {
    if (lead) dragging.current = false;
  }, [lead]);

  /* ── Property enrichment ── */
  const { data: enrichment, isLoading: enrichLoading } = useEnrichment(
    lead
      ? {
          address: lead.addr,
          city: lead.cityState?.split(",")[0]?.trim(),
          state: lead.cityState?.split(",")[1]?.trim(),
          zip: lead.zip?.replace(/^ZIP\s*/, "").split(" ")[0],
          lat: lead.lat,
          lng: lead.lng,
        }
      : null,
  );

  /* ── Live permit history at this property ──
   * Pulls every permit row keyed to this address, newest first, via
   * /api/permits/history. The current "live" permit is included in
   * the list — the contractor can see its position in the timeline
   * rather than it being visually separated from prior work.
   *
   * This is independent of the scorer's `permit_history` JSON, which
   * can lag behind fresh ingests — the drawer always shows the latest
   * DB state, not a pre-computed rollup. */
  const { permits: permitHistory, isLoading: historyLoading } = usePermitHistory(
    lead
      ? {
          address: lead.addr,
          zip: lead.zip?.replace(/^ZIP\s*/, "").split(" ")[0],
        }
      : null,
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = localHeight;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [localHeight],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const parentHeight =
      containerRef.current?.parentElement?.clientHeight ?? 600;
    const maxH = Math.round(parentHeight * MAX_HEIGHT_RATIO);
    const delta = startY.current - e.clientY;
    const next = Math.min(maxH, Math.max(MIN_HEIGHT, startH.current + delta));
    // Local-only update — parent doesn't re-render on every frame.
    setLocalHeight(next);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    // Clamp on commit so no state path can land the drawer below the floor.
    const committed = Math.max(MIN_HEIGHT, localHeight);
    onHeightChange(committed);
  }, [localHeight, onHeightChange]);

  // If the pointer is cancelled (pointercancel or pointerlost — e.g. user
  // scrolls, browser tab switches, pointer leaves capture scope) we need
  // to unstick dragging.current otherwise the height-sync effect stays
  // blocked and the drawer never rehydrates from the parent. React
  // exposes onLostPointerCapture which fires in both of those cases.
  const onLostPointerCapture = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setLocalHeight((prev) => Math.max(MIN_HEIGHT, prev));
  }, []);

  const onDoubleClick = useCallback(() => {
    const parentHeight =
      containerRef.current?.parentElement?.clientHeight ?? 600;
    const expanded = Math.round(parentHeight * 0.55);
    const next = localHeight < 250 ? expanded : 200;
    setLocalHeight(next);
    onHeightChange(next);
  }, [localHeight, onHeightChange]);

  if (!lead) return null;

  const proposal = generateProposal(lead);

  const urgencyBadge = {
    high: { label: "Act Now", className: "bg-[rgba(212,136,106,0.12)] text-hot" },
    medium: { label: "This Week", className: "bg-[rgba(212,162,74,0.12)] text-warm" },
    low: { label: "Follow Up", className: "bg-[rgba(74,127,192,0.12)] text-cool" },
  }[proposal.urgency];

  return (
    <FocusTrap active={!!lead}>
    <div
      ref={containerRef}
      style={{ height: localHeight }}
      className="absolute left-0 right-0 bottom-0 bg-card border-t border-border z-20 shadow-[0_-4px_24px_rgba(0,0,0,0.10)] animate-slide-up-panel flex flex-col"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors z-10"
        aria-label="Close detail"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onLostPointerCapture}
        onLostPointerCapture={onLostPointerCapture}
        onDoubleClick={onDoubleClick}
        className="flex justify-center items-center pt-1.5 pb-1 cursor-row-resize select-none shrink-0 touch-none"
      >
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>

      {/* Content */}
      <div className="flex px-5 pb-4 pt-1 gap-5 flex-1 min-h-0 overflow-hidden">
        {/* Column 1: Score + Urgency */}
        <div className="flex flex-col items-center justify-start shrink-0 w-[100px] pt-1">
          <div
            className={cn(
              "w-14 h-14 rounded-full border-[3px] flex items-center justify-center text-lg font-bold",
              scoreColor(lead.score),
            )}
          >
            {lead.score}
          </div>
          <p className="text-[11px] font-semibold text-foreground mt-1.5">
            {scoreLabel(lead.score)}
          </p>
          <p className="text-[10px] text-muted-foreground capitalize">
            {lead.trade ?? lead.type}
          </p>
          <span
            className={cn(
              "mt-2 px-2 py-0.5 rounded text-[10px] font-semibold",
              urgencyBadge.className,
            )}
          >
            {urgencyBadge.label}
          </span>
        </div>

        {/* Column 2: Permit Info + Proposal — scrollable */}
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin space-y-3 pr-2">
          {/* Address + Permit Number */}
          <div>
            <h2 className="text-sm font-semibold text-foreground truncate">
              {lead.addr}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {lead.fullAddress}
            </p>
            {lead.permitNumber && (
              <div className="flex items-center gap-1.5 mt-1">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground font-mono">
                  {lead.permitNumber}
                </span>
              </div>
            )}
          </div>

          {/* Permit Description */}
          {lead.permitDescription && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Scope of Work
                </span>
              </div>
              <p className="text-xs text-foreground leading-relaxed">
                {lead.permitDescription}
              </p>
            </div>
          )}

          {/* Value / Date / Type row */}
          <div className="flex items-center gap-4 text-xs flex-wrap">
            {lead.value && lead.value !== "---" && (
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Value</span>
                <span className="font-semibold text-foreground">
                  {lead.value}
                </span>
              </div>
            )}
            {lead.filedDate && (
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Filed</span>
                <span className="font-semibold text-foreground">
                  {formatDate(lead.filedDate)}
                </span>
              </div>
            )}
            {lead.permitAge != null && (
              <span className="text-muted-foreground">
                {lead.permitAge} days ago
              </span>
            )}
            {lead.type && (
              <div>
                <span className="text-muted-foreground">Type </span>
                <span className="font-medium text-foreground capitalize">
                  {lead.type}
                </span>
              </div>
            )}
          </div>

          {/* ── Predictive Proposal — visible at any height ── */}
          <div className="bg-bg-subtle rounded-lg px-3.5 py-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px] font-semibold text-foreground">
                {proposal.headline}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {proposal.insight}
            </p>
            {proposal.estimatedRevenue && (
              <p className="text-[11px] font-semibold text-foreground">
                {proposal.estimatedRevenue}
              </p>
            )}
          </div>

          {/* ── Competitive Window — visible when expanded ── */}
          {localHeight > 250 && (
            <div className="flex items-start gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Competitive Window
                </span>
                <p className="text-[11px] text-foreground mt-0.5">
                  {proposal.window}
                </p>
              </div>
            </div>
          )}

          {/* ── Recommended Actions — visible when expanded ── */}
          {localHeight > 280 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Recommended Actions
                </span>
              </div>
              <div className="space-y-1">
                {proposal.actions.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-foreground"
                  >
                    <span className="text-primary font-bold mt-px shrink-0">
                      {i + 1}.
                    </span>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Project stage timeline — Phase 0b wedge #5 ──
           * Planning → applied → issued → inspections → CO. Reads
           * permit_events (migration 00031) if present, synthesizes
           * from permits.status + dates otherwise. Always visible. */}
          <PermitTimeline
            permitId={lead.permitUuid ?? null}
            permit={{
              applied_date: lead.appliedDate,
              issued_date: lead.issuedDate,
              completed_date: lead.completedDate,
              status: lead.permitStatus,
            }}
          />

          {/* ── Score Breakdown — Phase 0a transparency ──
           * Always rendered (no height gate). Core wedge feature:
           * contractors must see why a lead scored what it scored,
           * not scroll to find it. Replaces the old 4-box "/25" grid
           * (which was wrong: those buckets cap at 20+20+15+15, not
           * 25 each, and were missing engagement/conversion entirely).
           * New breakdown reads `score_signals` jsonb + falls back to
           * legacy numeric columns for un-migrated rows. */}
          <ScoreSignalBreakdown lead={lead} />

          {/* ── Permit History at this Property ──
           * Three-tier layout to kill repetition:
           *   1. Summary strip — N permits, $X total, first filed Y
           *   2. Live permit card (if we're looking at a permit-backed lead)
           *   3. Prior permits, grouped by year, with exact dupes collapsed
           *
           * Dedup rules (src/lib/permit-history/dedupe.ts):
           *   Same (type + scope + ~value) within 30 days → one entry
           *   that shows "×N filings" when collapsed. This kills the
           *   common case where a jurisdiction files plan-review +
           *   issue + re-issue for the same project. */}
          {(historyLoading || permitHistory.length > 0) && (
            <PermitHistorySection
              history={permitHistory}
              currentPermitNumber={lead.permitNumber}
              isLoading={historyLoading}
              expandedDescriptions={localHeight > 280}
            />
          )}

        </div>

        {/* Column 3: Homeowner Details + Actions */}
        <div className="shrink-0 w-[220px] flex flex-col justify-between border-l border-border pl-4 overflow-y-auto scrollbar-thin">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Homeowner
              </h3>
              {enrichLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>

            {/* Owner name — prefer explicit first+last split when both are
             * present; fall back to the enriched full name, then lead.owner. */}
            {(() => {
              const first = (lead.firstName ?? "").trim();
              const last = (lead.lastName ?? "").trim();
              const hasSplit = first.length > 0 || last.length > 0;
              const displayName = hasSplit
                ? [first, last].filter(Boolean).join(" ")
                : (enrichment?.owner_name ?? (lead.owner && lead.owner !== "Unknown" ? lead.owner : null));
              if (!displayName) {
                return <p className="text-xs text-fg-subtle italic">Owner info pending</p>;
              }
              return (
                <>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{displayName}</p>
                  </div>
                  {hasSplit && (
                    <div className="flex flex-col gap-0 pl-[18px]">
                      {first && <span className="text-[10px] text-muted-foreground">First: <span className="text-foreground">{first}</span></span>}
                      {last && <span className="text-[10px] text-muted-foreground">Last: <span className="text-foreground">{last}</span></span>}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Co-owner */}
            {(lead.coOwner || enrichment?.co_owner) && (
              <p className="text-[11px] text-muted-foreground pl-[18px]">
                Co-owner: {enrichment?.co_owner ?? lead.coOwner}
              </p>
            )}

            {/* Phone */}
            {lead.phone && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" />
                <span>{lead.phone}</span>
              </div>
            )}

            {/* Email */}
            {lead.email && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{lead.email}</span>
              </div>
            )}

            {/* Mailing address */}
            {(lead.mailing || enrichment?.mailing_address) && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{enrichment?.mailing_address ?? lead.mailing}</span>
              </div>
            )}

            {/* Owner occupied badge */}
            {enrichment?.owner_occupied != null && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <Home className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className={enrichment.owner_occupied ? "text-green-600 font-medium" : "text-muted-foreground"}>
                  {enrichment.owner_occupied ? "Owner occupied" : "Non-owner occupied"}
                </span>
              </div>
            )}

            {/* Owner since */}
            {enrichment?.owner_since && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>Owner since {enrichment.owner_since}</span>
              </div>
            )}

            {/* Property Details (expanded view) */}
            {localHeight > 250 && (enrichment || lead.propertyValue || lead.yearBuilt) && (
              <div className="mt-2.5 pt-2 border-t border-border space-y-1">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Property Details
                </h3>

                {(enrichment?.assessed_value ?? lead.assessedValue) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Assessed</span>
                    <span className="text-foreground font-medium">
                      {enrichment?.assessed_value
                        ? `$${Number(enrichment.assessed_value).toLocaleString()}`
                        : lead.assessedValue}
                    </span>
                  </div>
                )}

                {(enrichment?.property_value ?? lead.propertyValue) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Est. Value</span>
                    <span className="text-foreground font-medium">
                      {enrichment?.property_value
                        ? `$${Number(enrichment.property_value).toLocaleString()}`
                        : lead.propertyValue}
                    </span>
                  </div>
                )}

                {(enrichment?.year_built ?? lead.yearBuilt) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Year Built</span>
                    <span className="text-foreground">{enrichment?.year_built ?? lead.yearBuilt}</span>
                  </div>
                )}

                {(enrichment?.home_sqft ?? lead.homeSqft) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Home Sqft</span>
                    <span className="text-foreground">{Number(enrichment?.home_sqft ?? lead.homeSqft).toLocaleString()}</span>
                  </div>
                )}

                {(enrichment?.lot_sqft ?? lead.lotSqft) && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Lot Sqft</span>
                    <span className="text-foreground">{Number(enrichment?.lot_sqft ?? lead.lotSqft).toLocaleString()}</span>
                  </div>
                )}

                {enrichment?.source && enrichment.source !== "none" && (
                  <p className="text-[9px] text-muted-foreground mt-1 italic">
                    via {enrichment.source.replace(/_/g, " ")}
                  </p>
                )}
              </div>
            )}

            {/* Permit status badge */}
            {localHeight > 320 && lead.permitNumber && (
              <div className="mt-2.5 pt-2 border-t border-border">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Permit Status
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  <span className="text-[11px] text-foreground font-medium">
                    Active / Filed
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  #{lead.permitNumber}
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-3 shrink-0">
            {lead.phone ? (
              <a
                href={`tel:${lead.phone.replace(/\D/g, "")}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                <Phone className="h-3 w-3" />
                Call
              </a>
            ) : enrichment?.mailing_address ? (
              <span className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold cursor-default" title="Use mailing address for direct mail">
                <MapPin className="h-3 w-3" />
                Mail
              </span>
            ) : (
              <span className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-default">
                <Phone className="h-3 w-3" />
                Call
              </span>
            )}
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-foreground text-xs font-semibold hover:bg-accent transition-colors"
              >
                <Mail className="h-3 w-3" />
                Email
              </a>
            ) : (
              <span className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-muted-foreground text-xs font-semibold cursor-default">
                <Mail className="h-3 w-3" />
                Email
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
    </FocusTrap>
  );
}
