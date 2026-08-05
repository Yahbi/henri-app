"use client";

import { useEffect } from "react";
import { X, Hash, Calendar, FileText, TrendingUp, Zap, Clock, Target } from "lucide-react";
import { useEnrichment } from "@/hooks/useEnrichment";
import { usePermitHistory } from "@/hooks/usePermitHistory";
import { usePermitDetail } from "@/hooks/usePermitDetail";
import { useLeadContext } from "@/hooks/useLeadContext";
import { useDrawerResize } from "@/hooks/useDrawerResize";
import { useSavedLeads } from "@/hooks/useSavedLeads";
import { useHiddenLeads } from "@/hooks/useHiddenLeads";
import { FocusTrap } from "@/components/ui/focus-trap";
import { ScoreSignalBreakdown } from "./ScoreSignalBreakdown";
import { PermitTimeline } from "./PermitTimeline";
import { PermitHistorySection } from "./PermitHistorySection";
import { PropertyContextSection } from "./PropertyContextSection";
import { CrossTradeOpportunities } from "./CrossTradeOpportunities";
import { CascadePredictionPanel } from "./CascadePrediction";
import { StormImpactPanel } from "./StormImpact";
import { PermitAnomalyPanel } from "./PermitAnomaly";
import { LeadSummaryPanel } from "./LeadSummary";
import { usePredictions } from "@/hooks/usePredictions";
import { ApplicantBadge } from "./ApplicantBadge";
import { IntentChip, IntentChipReasonsList } from "./IntentChip";
import { LeadActionButtons } from "./LeadActionButtons";
import { DrawerResizeHandle } from "./DrawerResizeHandle";
import { LeadDrawerScoreColumn, type UrgencyBadge } from "./LeadDrawerScoreColumn";
import { LeadDrawerHomeownerColumn } from "./LeadDrawerHomeownerColumn";
import type { LeadData } from "./LeadCard";
import type { CrossTradeSuggestion } from "@/lib/predictive/rules";
import { generateProposal } from "@/lib/proposals";
import { formatDate } from "./LeadDetailDrawer.helpers";

/* Audit-04-29 priority D step 2 — refactor map:
 *   - Drag math + ResizeObserver → `src/hooks/useDrawerResize.ts`
 *   - Visible drag bar JSX        → `./DrawerResizeHandle`
 *   - Score circle + urgency      → `./LeadDrawerScoreColumn`
 *   - Homeowner / property / business / actions → `./LeadDrawerHomeownerColumn`
 *   - SOURCE_LABELS, ProvenanceChip, scoreColor/Label, formatDate (D step 1)
 *                                  → `./LeadDetailDrawer.helpers`
 *
 * What's left in this file: the drawer's outer container, the close button,
 * and the middle content column (permit info → proposal → score breakdown
 * → property context → permit history). The middle column is the wedge
 * surface — the score breakdown lives there per CLAUDE.md bullet #2 and
 * MUST stay visible at every height. */

// MIN_HEIGHT must match the parent dashboard's localStorage validation
// floor (`src/app/(dashboard)/dashboard/page.tsx`, `n >= 200`).
const MIN_HEIGHT = 200;
// Ceiling: 100% of parent so the user can fully cover the map / list area.
const MAX_HEIGHT_RATIO = 1.0;

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
  /* ── Resize state via the extracted hook ── */
  const drawer = useDrawerResize({
    height,
    onHeightChange,
    resetTrigger: lead,
    minHeight: MIN_HEIGHT,
    maxHeightRatio: MAX_HEIGHT_RATIO,
  });

  /* ── Escape closes the drawer ──
   * The drawer is `role="dialog" aria-modal="true"` and wrapped in a
   * FocusTrap that only cycles Tab, so before this a keyboard user who
   * entered the drawer had no way out except finding the X button. */
  useEffect(() => {
    if (!lead) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

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
  const { permits: permitHistory, isLoading: historyLoading, error: historyError } = usePermitHistory(
    lead
      ? {
          address: lead.addr,
          zip: lead.zip?.replace(/^ZIP\s*/, "").split(" ")[0],
        }
      : null,
  );

  /* ── Property context (Phase 0 free-tier expansion) ──
   * Pulls roof / HVAC / pool / solar / panel age (derived from permit
   * history at this address), neighborhood permit-activity count, and
   * any recent storm event in the same ZIP. Graceful-degrades silently
   * if the views (migration 00055) aren't applied yet. */
  const { data: contextData, isLoading: contextLoading } = useLeadContext(lead?.id);

  /* ── On-demand permit detail (description, applicant, dates) ──
   * The dashboard list fetch in god-mode skips the heavy `permits(...)`
   * embed (see `useLeads({ skip_permits_join: true })`) so we can scale
   * past Postgres's 8-second statement-timeout ceiling on paginated pulls.
   * The drawer compensates by lazy-loading the few fields it actually
   * needs the moment it opens. */
  const { permit: fetchedPermit } = usePermitDetail(lead?.permitNumber ?? null);

  /* ── Tier A+ Sprint 1 predictions: cascade + storm + anomaly ──
   * Read-only cached predictions refreshed weekly by
   * /api/cron/predictive-refresh. Each panel hides itself when it has no
   * data to show — never blank shells. */
  const { data: predictions } = usePredictions(
    lead?.id ?? null,
    lead?.permitUuid ?? lead?.permitNumber ?? fetchedPermit?.id ?? null,
  );

  /* ── Saved / hidden state (Module 11 wiring) ──
   * Read the contractor's saved/hidden sets so the drawer's action
   * buttons open reflecting the TRUE state (a previously-saved lead
   * shows "saved", not "unsaved"). The shared module store in these
   * hooks means our optimistic add/remove also updates the LeadsPanel
   * instance — so hiding a lead removes its row from the list at once. */
  const { savedIds, add: addSaved, remove: removeSaved } = useSavedLeads();
  const { hiddenIds, add: addHidden } = useHiddenLeads();

  /* ── WS7: contact-view analytics (invisible to the contractor) ──
   * When the drawer opens for a lead that actually carries contact info
   * (phone / email / owner present), log a single best-effort view event.
   * PURE ANALYTICS — no counter, no gating, no reveal UI. Fire-and-forget,
   * cancellation-safe, errors swallowed. One POST per drawer-open per lead. */
  const leadId = lead?.id ?? null;
  const hasContact = !!(lead?.phone || lead?.email || lead?.owner);
  useEffect(() => {
    if (!leadId || !hasContact) return;
    let cancelled = false;
    void fetch(`/api/leads/${leadId}/view-contact`, { method: "POST" }).catch(
      () => {},
    );
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [leadId, hasContact]);

  if (!lead) return null;

  const proposal = generateProposal(lead);

  // Urgency badge — uses the canonical hot/warm/cool tokens via color-mix.
  const urgencyBadge: UrgencyBadge = {
    high:   { label: "Act Now",    className: "bg-[color-mix(in_srgb,var(--hot)_12%,transparent)]  text-hot" },
    medium: { label: "This Week",  className: "bg-[color-mix(in_srgb,var(--warm)_12%,transparent)] text-warm" },
    low:    { label: "Follow Up",  className: "bg-[color-mix(in_srgb,var(--cool)_12%,transparent)] text-cool" },
  }[proposal.urgency];

  return (
    <FocusTrap active={!!lead}>
    <div
      ref={drawer.containerRef}
      style={{ height: drawer.localHeight }}
      className="absolute left-0 right-0 bottom-0 bg-card border-t border-border z-20 shadow-drawer-top animate-slide-up-panel flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-drawer-title"
    >
      {/* Module 11 (2026-05-09) — Save / Hide actions next to close.
          initialSaved/initialHidden open the buttons in their true state;
          onSaved/onHidden push optimistic updates to the shared sets so
          the LeadsPanel filter + list react immediately. The drawer is
          keyed by lead id upstream, so these remount per lead. */}
      <LeadActionButtons
        leadId={lead.id}
        initialSaved={savedIds.has(lead.id)}
        initialHidden={hiddenIds.has(lead.id)}
        onSaved={(saved) => (saved ? addSaved(lead.id) : removeSaved(lead.id))}
        onHidden={() => {
          addHidden(lead.id);
          onClose();
          // Hiding removes the originating LeadCard from the virtual list,
          // so FocusTrap's restore target is already detached and focus
          // would land on <body>. Park it on the leads list container
          // instead (tabIndex={-1} in LeadsPanel's VirtualizedLeadList).
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLElement>("[data-leads-scroll]")
              ?.focus();
          });
        }}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors z-10"
        aria-label="Close detail"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Drag handle — extracted to ./DrawerResizeHandle (D step 2). */}
      <DrawerResizeHandle
        localHeight={drawer.localHeight}
        parentMaxHeight={drawer.parentMaxHeight}
        minHeight={drawer.minHeight}
        onMouseDown={drawer.onMouseDown}
        onDoubleClick={drawer.onDoubleClick}
        onKeyDown={drawer.onKeyDown}
      />

      {/* Content — stacks vertically below sm (phones), 3-column row at
       * sm+. When stacked, the container scrolls so the middle score-
       * breakdown column stays fully reachable (wedge contract). */}
      <div className="flex flex-col sm:flex-row px-5 pb-4 pt-1 gap-5 flex-1 min-h-0 overflow-y-auto sm:overflow-hidden">
        {/* Column 1: Score + Urgency — extracted */}
        <LeadDrawerScoreColumn lead={lead} urgencyBadge={urgencyBadge} />

        {/* Column 2: Permit Info + Proposal — scrollable */}
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin space-y-3 pr-2">
          {/* Address + Permit Number */}
          <div>
            <h2 id="lead-drawer-title" className="text-sm font-semibold text-foreground truncate">
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

            {/* Applicant badge — Phase 1.3 DIY-vs-pro classifier. */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <ApplicantBadge
                permit={{
                  applicant_name:
                    lead.permitApplicantName ??
                    fetchedPermit?.applicant_name ??
                    undefined,
                  contractor_name:
                    lead.permitContractorName ??
                    fetchedPermit?.contractor_name ??
                    undefined,
                  owner_name: lead.owner ?? null,
                }}
                lead={{ cascade_count: lead.cascadeCount ?? null }}
              />
              {/* Module 1 (2026-05-09) — intent stage chip. Hover for the
                  top reason codes. Renders only when classifier has stamped
                  the row; nothing shown for pre-backfill rows.
                  Module 7 — passes stage_entered_at so the chip can
                  show "for 12d" duration in the lead's current stage. */}
              <IntentChip
                stage={lead.opportunityStage}
                reasonCodes={lead.reasonCodes}
                stageEnteredAt={contextData?.stage_entered_at ?? null}
              />
            </div>
          </div>

          {/* Module 1 (2026-05-09) — top-3 reason codes in plain English.
              Sits between the chip + applicant row and the scope-of-work
              block so the contractor sees the "why this matters today"
              context up top. Hidden when there are no reason codes
              (pre-backfill or uncategorised rows). */}
          {lead.reasonCodes && lead.reasonCodes.length > 0 && (
            <IntentChipReasonsList reasonCodes={lead.reasonCodes} topN={3} />
          )}

          {/* Permit Description — read from joined permit row or on-demand. */}
          {(lead.permitDescription ?? fetchedPermit?.description) && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Scope of Work
                </span>
              </div>
              <p className="text-xs text-foreground leading-relaxed">
                {lead.permitDescription ?? fetchedPermit?.description}
              </p>
            </div>
          )}

          {/* Value / Date / Type row.
           * `lead.filedDate` and `lead.permitAge` both derive from
           * permits.applied_date / permits.issued_date in `mapLead`. When
           * the dashboard list fetch skipped the permits embed (god-mode
           * path), they're null until `fetchedPermit` lands. */}
          {(() => {
            const effectiveFiled =
              lead.filedDate ??
              fetchedPermit?.applied_date ??
              fetchedPermit?.issued_date ??
              null;
            const effectiveAgeDays =
              lead.permitAge ??
              (effectiveFiled
                ? Math.floor(
                    // eslint-disable-next-line react-hooks/purity -- intentional wall-clock for "filed N days ago" display; not stored in state
                    (Date.now() - new Date(effectiveFiled).getTime()) /
                      86400000,
                  )
                : null);
            return (
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
                {effectiveFiled && (
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Filed</span>
                    <span className="font-semibold text-foreground">
                      {formatDate(effectiveFiled)}
                    </span>
                  </div>
                )}
                {effectiveAgeDays != null && effectiveAgeDays >= 0 && (
                  <span className="text-muted-foreground">
                    {effectiveAgeDays} days ago
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
            );
          })()}

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

          {/* ── Competitive Window ── always visible
           * (height gate removed 2026-04-26 per CLAUDE.md wedge bullet #2:
           * "Never hide 'why this score' behind a height gate") */}
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

          {/* ── Recommended Actions ── always visible */}
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

          {/* ── Tier A+ Sprint 3: A1 LLM lead-summary panel ──
           * Renders 2-3 sentence narrative summarizing the predictive
           * panels below. Auto-fires on lead-open; "Regenerate" available.
           * Hides itself when no output. Disclaimer rendered. */}
          <LeadSummaryPanel leadId={lead.id} />

          {/* ── Tier A+ Sprint 1: Predictive panels ──
           * Each panel hides itself when there's nothing to show. They render
           * in priority order: cascade → storm → anomaly. Refreshed weekly by
           * /api/cron/predictive-refresh. NO PII, NO LLM, statistical only. */}
          <PermitAnomalyPanel anomaly={predictions?.anomaly ?? null} />
          <StormImpactPanel storm={predictions?.storm ?? null} />
          <CascadePredictionPanel predictions={predictions?.cascade ?? []} />

          {/* ── Cross-trade opportunities — Phase 1.2 predictive rules ── */}
          <CrossTradeOpportunities
            suggestions={(lead.crossTradeSuggestions as CrossTradeSuggestion[] | undefined) ?? null}
            leadId={lead.id}
          />

          {/* ── Project stage timeline — Phase 0b wedge #5 ── */}
          <PermitTimeline
            permitId={lead.permitUuid ?? lead.permitNumber ?? fetchedPermit?.id ?? null}
            permit={{
              applied_date: lead.appliedDate ?? fetchedPermit?.applied_date ?? undefined,
              issued_date: lead.issuedDate ?? fetchedPermit?.issued_date ?? undefined,
              completed_date: lead.completedDate ?? fetchedPermit?.completed_date ?? undefined,
              status: lead.permitStatus ?? fetchedPermit?.status ?? undefined,
            }}
          />

          {/* ── Score Breakdown — Phase 0a transparency. Always rendered. */}
          <ScoreSignalBreakdown lead={lead} />

          {/* ── Property Context (Phase 0 free-tier expansion) ── */}
          <PropertyContextSection data={contextData} isLoading={contextLoading} />

          {/* ── Permit History at this Property ── */}
          {historyError ? (
            /* A fetch failure used to make the whole section vanish, which
             * is indistinguishable from "this property has no prior work". */
            <p role="alert" className="text-[11px] text-destructive">
              Couldn&apos;t load this property&apos;s permit history.
            </p>
          ) : (historyLoading || permitHistory.length > 0) && (
            <PermitHistorySection
              history={permitHistory}
              currentPermitNumber={lead.permitNumber}
              isLoading={historyLoading}
              expandedDescriptions={true}
            />
          )}
        </div>

        {/* Column 3: Homeowner / Property / Business / Actions — extracted */}
        <LeadDrawerHomeownerColumn
          lead={lead}
          enrichment={enrichment}
          enrichLoading={enrichLoading}
          /* Same resolution order the PermitTimeline panel above uses, so
           * the two can't disagree about the same permit. */
          permitStatus={lead.permitStatus ?? fetchedPermit?.status ?? null}
        />
      </div>
    </div>
    </FocusTrap>
  );
}
