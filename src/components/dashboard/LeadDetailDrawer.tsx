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
  Home,
  User,
  Loader2,
  GripHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useEnrichment } from "@/hooks/useEnrichment";
import { usePermitHistory } from "@/hooks/usePermitHistory";
import { usePermitDetail } from "@/hooks/usePermitDetail";
import { useLeadContext } from "@/hooks/useLeadContext";
import { FocusTrap } from "@/components/ui/focus-trap";
import { ScoreSignalBreakdown } from "./ScoreSignalBreakdown";
import { PermitTimeline } from "./PermitTimeline";
import { PermitHistorySection } from "./PermitHistorySection";
import { PropertyContextSection } from "./PropertyContextSection";
import { CrossTradeOpportunities } from "./CrossTradeOpportunities";
import { ApplicantBadge } from "./ApplicantBadge";
import type { LeadData } from "./LeadCard";
import type { CrossTradeSuggestion } from "@/lib/predictive/rules";
import { generateProposal } from "@/lib/proposals";

/* ── Helpers ──────────────────────────────────────────────────────────── */

/* Phase 2.6 (2026-04-26 session): per-field provenance attribution.
 *
 * The orchestrator at `src/lib/enrichment/orchestrator.ts` writes the
 * primary contact source into `leads.contact_source` (string) — e.g.
 * "voter_file_fl", "opencorporates", "apollo", "numverify". We surface
 * this as a tiny "via X" chip below the relevant contact row so the
 * contractor can see WHERE each piece of data came from. Trust-building.
 *
 * Source-label mapping: snake_case → human-readable. Falls back to the
 * raw label for unknown sources (better than dropping the chip).
 */
const SOURCE_LABELS: Record<string, string> = {
  upstream: "permit",
  same_address_permit: "sibling permit",
  voter_file_fl: "FL voter file",
  voter_file_nc: "NC voter file",
  voter_file_oh: "OH voter file",
  county_gis: "county GIS",
  regrid: "Regrid",
  contractor_license: "license board",
  cslb: "CSLB",
  opencorporates: "OpenCorporates",
  fec: "FEC",
  voter_reg_vendor: "voter reg",
  hunter_io: "Hunter",
  google_places: "Google Places",
  yelp: "Yelp",
  osm_contact: "OpenStreetMap",
  ppp_sba: "PPP loan",
  permit_description: "permit text",
  numverify: "Numverify",
  cloudmersive: "Cloudmersive",
  weatherstack: "WeatherStack",
  apollo: "Apollo",
};

function formatSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return SOURCE_LABELS[raw] ?? raw.replace(/_/g, " ");
}

/** Tiny attribution chip rendered below an enriched value. Pure CSS,
 *  zero data fetching — sources are already on the lead row. */
function ProvenanceChip({ source }: { source: string | null | undefined }) {
  const label = formatSource(source);
  if (!label) return null;
  return (
    <span className="text-[9px] text-muted-foreground/70 italic ml-[18px]">
      via {label}
    </span>
  );
}

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

/* ── Constants ─────────────────────────────────────────────────────────── */

// Floor: keep enough for the drag handle + the lead-header strip to stay
// reachable. 80px is the visual minimum below which the drawer becomes
// hard to grab again. Below this, drag releases snap up to MIN_HEIGHT.
const MIN_HEIGHT = 80;
// Ceiling: 100% of parent so the user can fully cover the map / list area
// when they want a focused, full-bleed read on a single lead. Prior 92%
// cap was per audit feedback ("let the user set up how large the banner
// should be by stretching it") — but 92% still left a thin strip of map
// visible that some users found distracting. Going to 1.0 gives full
// freedom; the dashboard tabs remain accessible above the parent
// container so navigation isn't blocked.
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

  // Track the parent container's height in state so the resize handle
  // can render an accurate aria-valuemax without dereferencing a ref
  // during render (rules-of-refs violation). Updated via ResizeObserver
  // so window resizes update the announced bounds in real time.
  const [parentMaxHeight, setParentMaxHeight] = useState<number>(600);

  // When the parent's `height` prop changes (e.g., programmatic reset), sync
  // it down — but only when we're NOT actively dragging, otherwise we'd
  // overwrite the user's live drag. Clamp to MIN_HEIGHT so a synthesized
  // pointer event that left dragging.current=true doesn't permanently
  // strand the drawer at 0 height on the next mount.
  useEffect(() => {
    // Sync prop down when not actively dragging; cannot derive because we own localHeight during drags
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

  // Observe the parent container — `parentMaxHeight` powers both
  // aria-valuemax on the resize handle and the visible "you can drag
  // up to N px" calculation. Without this, a window resize would let
  // a previously-valid drag exceed the new viewport's bounds and the
  // screen reader would announce stale max values.
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const h = parent.clientHeight || 600;
      setParentMaxHeight(Math.round(h * MAX_HEIGHT_RATIO));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
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

  /* ── Property context (Phase 0 free-tier expansion) ──
   * Pulls roof / HVAC / pool / solar / panel age (derived from permit
   * history at this address), neighborhood permit-activity count, and
   * any recent storm event in the same ZIP. All three layers compose
   * data Henri already has on hand; no vendor calls fire. Renders as
   * a compact section between the score breakdown and permit history.
   * Graceful-degrades silently if the views (migration 00055) aren't
   * applied yet or the API errors. */
  const { data: contextData, isLoading: contextLoading } = useLeadContext(lead?.id);

  /* ── On-demand permit detail (description, applicant, dates) ──
   * The dashboard list fetch in god-mode skips the heavy `permits(...)`
   * embed (see `useLeads({ skip_permits_join: true })`) so we can scale
   * past Postgres's 8-second statement-timeout ceiling on paginated pulls.
   * The drawer compensates by lazy-loading the few fields it actually
   * needs the moment it opens. One round-trip per drawer open is cheap
   * relative to a 25,000-row blanket join on every list paint.
   *
   * `lead.permitNumber` is the leads.permit_id FK — same UUID as the
   * permits table primary key. The hook returns null until the fetch
   * lands; the inline `??` expressions below let the drawer keep using
   * any fields already populated (regular contractors / pre-skip-join
   * paths) and fill in the rest after the round-trip. */
  const { permit: fetchedPermit } = usePermitDetail(lead?.permitNumber ?? null);

  /* ── Drag-to-resize: dead-simple mouse-event pattern ───────────────
   *
   * Click-and-drag: the canonical implementation that works the same way
   * in every browser, no pointer-capture / pointer-event indirection.
   *
   *   1. mousedown on the handle  → record startY + startHeight, attach
   *      document mousemove + mouseup, set the body cursor + user-select
   *   2. mousemove (anywhere on the page) → compute delta, call
   *      setLocalHeight to redraw the drawer
   *   3. mouseup (anywhere on the page) → commit the final height to the
   *      parent (so it persists to localStorage), remove document
   *      listeners, restore body styles
   *
   * Why this layout vs the prior implementations:
   *
   *   - setPointerCapture on the handle (pre-b083b02): broke when the
   *     handle re-rendered mid-drag because aria-valuenow updated;
   *     browsers dropped capture inconsistently, fired phantom
   *     pointercancel events that snapped the drawer to MIN_HEIGHT.
   *
   *   - Document listeners + onHeightChange inside a state-updater
   *     (b083b02): React fired the "Cannot update a component while
   *     rendering a different component" warning because setLocalHeight's
   *     updater function called onHeightChange (which calls the parent's
   *     setState). State updaters must be pure — no side effects.
   *
   *   - Current: a closure-local `currentHeight` variable tracks the
   *     latest height during the drag. We read it in mouseup and call
   *     onHeightChange OUTSIDE of any state-updater, so React's
   *     during-render check is happy. mousedown / mousemove / mouseup
   *     are direct browser events — no pointer-to-mouse mapping
   *     uncertainty. */
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = localHeight;
      // Closure-local: the latest height during this specific drag.
      // Read by onUp to commit to the parent without violating React's
      // no-setState-in-updater rule. Initialised to startH so a click
      // without movement still commits sensibly.
      let currentHeight = localHeight;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const parent = containerRef.current?.parentElement;
        const parentHeight = parent?.clientHeight ?? 600;
        const maxH = Math.round(parentHeight * MAX_HEIGHT_RATIO);
        const delta = startY.current - ev.clientY;
        const next = Math.min(
          maxH,
          Math.max(MIN_HEIGHT, startH.current + delta),
        );
        currentHeight = next;
        setLocalHeight(next);
      };

      const onUp = () => {
        if (!dragging.current) return;
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Commit OUTSIDE of any state-updater — straight call to the
        // parent's setBottomHeight (which writes to localStorage).
        onHeightChange(Math.max(MIN_HEIGHT, currentHeight));
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // Visual cue: row-resize cursor stays on for the entire drag, not
      // just over the handle. Disable text-selection while dragging so a
      // long drag across the page doesn't accidentally select half the
      // dashboard contents.
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [localHeight, onHeightChange],
  );

  const onDoubleClick = useCallback(() => {
    const parentHeight =
      containerRef.current?.parentElement?.clientHeight ?? 600;
    const expanded = Math.round(parentHeight * 0.55);
    const next = localHeight < 250 ? expanded : 200;
    setLocalHeight(next);
    onHeightChange(next);
  }, [localHeight, onHeightChange]);

  /* Keyboard resize — ArrowUp/Down nudges by 24px, Shift = 96px,
   * Home/End jump to min/max. Wedge contract bullet #2 says the score
   * breakdown can never be hidden, so a keyboard user must be able to
   * grow the drawer the same way a mouse user does. ARIA separator
   * pattern (role="separator", aria-orientation="horizontal",
   * aria-valuenow/min/max) makes it screen-reader navigable. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const parentHeight =
        containerRef.current?.parentElement?.clientHeight ?? 600;
      const maxH = Math.round(parentHeight * MAX_HEIGHT_RATIO);
      const step = e.shiftKey ? 96 : 24;
      let next: number | null = null;
      switch (e.key) {
        case "ArrowUp":
          next = Math.min(maxH, localHeight + step);
          break;
        case "ArrowDown":
          next = Math.max(MIN_HEIGHT, localHeight - step);
          break;
        case "Home":
          next = MIN_HEIGHT;
          break;
        case "End":
          next = maxH;
          break;
        case "Enter":
        case " ":
          // Same expand/collapse toggle as the double-click affordance.
          next =
            localHeight < 250 ? Math.round(parentHeight * 0.55) : 200;
          break;
        default:
          return;
      }
      e.preventDefault();
      setLocalHeight(next);
      onHeightChange(next);
    },
    [localHeight, onHeightChange],
  );

  if (!lead) return null;

  const proposal = generateProposal(lead);

  // Urgency badge — uses the canonical hot/warm/cool tokens via
  // color-mix. Migrated from raw rgba 2026-04-25 per design-system audit.
  const urgencyBadge = {
    high:   { label: "Act Now",    className: "bg-[color-mix(in_srgb,var(--hot)_12%,transparent)]  text-hot" },
    medium: { label: "This Week",  className: "bg-[color-mix(in_srgb,var(--warm)_12%,transparent)] text-warm" },
    low:    { label: "Follow Up",  className: "bg-[color-mix(in_srgb,var(--cool)_12%,transparent)] text-cool" },
  }[proposal.urgency];

  return (
    <FocusTrap active={!!lead}>
    <div
      ref={containerRef}
      style={{ height: localHeight }}
      className="absolute left-0 right-0 bottom-0 bg-card border-t border-border z-20 shadow-drawer-top animate-slide-up-panel flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-drawer-title"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors z-10"
        aria-label="Close detail"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Drag handle — wider hit area + visible grip + keyboard a11y.
       *
       * Pre-2026-04-27 the handle was a 40×4 pill with no hover state,
       * no tooltip, and no keyboard support — users couldn't tell the
       * banner was resizable. The user audit feedback ("let the user
       * set up how large the banner should be by stretching it") was
       * really about discoverability: the affordance was hiding.
       *
       * Now: 14px hit target, grip icon + label on hover, primary-color
       * highlight on hover/focus, full keyboard support (Arrow keys,
       * Shift+Arrow for big steps, Home/End for min/max, Enter/Space
       * to toggle expand/collapse). Persists across sessions via the
       * parent dashboard's localStorage hook. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize lead detail panel — drag, or use arrow keys"
        aria-valuenow={localHeight}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={parentMaxHeight}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        title="Drag to resize · double-click to toggle · arrow keys also work"
        className={cn(
          "group flex justify-center items-center gap-2 py-2 cursor-row-resize select-none shrink-0 touch-none",
          "border-b border-transparent hover:border-border/60 hover:bg-bg-subtle/40",
          "focus-visible:outline-none focus-visible:bg-bg-subtle focus-visible:border-primary/40",
          "transition-colors",
        )}
      >
        <div
          className={cn(
            "h-1 w-12 rounded-full bg-border",
            "group-hover:w-16 group-hover:bg-primary/60",
            "group-focus-visible:w-16 group-focus-visible:bg-primary",
            "transition-all",
          )}
        />
        <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
          <GripHorizontal className="h-3 w-3" />
          <span>Drag to resize</span>
        </div>
        <div
          className={cn(
            "h-1 w-12 rounded-full bg-border",
            "group-hover:w-16 group-hover:bg-primary/60",
            "group-focus-visible:w-16 group-focus-visible:bg-primary",
            "transition-all",
          )}
        />
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

            {/* Applicant badge — Phase 1.3 DIY-vs-pro classifier.
             * Surfaces "who pulled the permit" so the contractor can
             * tailor outreach. Pure UI — uses existing
             * permits.applicant_name + permits.contractor_name fields
             * (no migration needed). When `skip_permits_join` was used
             * (god-mode), these load from `fetchedPermit` (one extra
             * round-trip when the drawer opens) instead of the embed. */}
            <div className="mt-2">
              <ApplicantBadge
                permit={{
                  applicant_name:
                    ((lead as unknown as Record<string, unknown>)
                      .permitApplicantName as string | undefined) ??
                    fetchedPermit?.applicant_name ??
                    undefined,
                  contractor_name:
                    ((lead as unknown as Record<string, unknown>)
                      .permitContractorName as string | undefined) ??
                    fetchedPermit?.contractor_name ??
                    undefined,
                  owner_name: lead.owner ?? null,
                }}
                lead={{ cascade_count: lead.cascadeCount ?? null }}
              />
            </div>
          </div>

          {/* Permit Description — read from the lead's joined permit row
           * (regular contractors) or `fetchedPermit` from the on-demand
           * lookup (god-mode skip-permits-join path). */}
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
           * path), they're null until `fetchedPermit` lands — at which
           * point we recompute on the fly so the chips appear without a
           * full re-fetch. */}
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
          {true && (
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

          {/* ── Recommended Actions ── always visible
           * (height gate removed 2026-04-26 — wedge contract #2) */}
          {true && (
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

          {/* ── Cross-trade opportunities — Phase 1.2 predictive rules ──
           * Reads `lead.crossTradeSuggestions` (jsonb column from
           * migration 00045, written by the cron scorer when env
           * WRITE_CROSS_TRADE_SUGGESTIONS=1). Renders only when at
           * least one rule fired. The "Forward" action will route the
           * permit to a contractor in the suggested trade — exclusivity
           * locks are per-(lead_id, trade) so multi-trade routing is
           * non-conflicting. */}
          <CrossTradeOpportunities
            suggestions={
              ((lead as unknown as Record<string, unknown>)
                .crossTradeSuggestions as CrossTradeSuggestion[] | undefined) ??
              null
            }
            leadId={lead.id}
          />

          {/* ── Project stage timeline — Phase 0b wedge #5 ──
           * Planning → applied → issued → inspections → CO. Reads
           * permit_events (migration 00031) if present, synthesizes
           * from permits.status + dates otherwise. Always visible.
           *
           * Lifecycle dates fall back to `fetchedPermit` when the
           * dashboard list fetch skipped the permits embed (god-mode
           * skip-permits-join path). The `permitId` powers the
           * permit_events lookup; we use the lead's `permitNumber`
           * (which IS the permits PK) as the canonical source so the
           * timeline still queries even before fetchedPermit lands. */}
          <PermitTimeline
            permitId={lead.permitUuid ?? lead.permitNumber ?? fetchedPermit?.id ?? null}
            permit={{
              applied_date: lead.appliedDate ?? fetchedPermit?.applied_date ?? undefined,
              issued_date: lead.issuedDate ?? fetchedPermit?.issued_date ?? undefined,
              completed_date: lead.completedDate ?? fetchedPermit?.completed_date ?? undefined,
              status: lead.permitStatus ?? fetchedPermit?.status ?? undefined,
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

          {/* ── Property Context (Phase 0 free-tier expansion) ──
           * Derived equipment ages (roof/HVAC/pool/solar/panel),
           * adjacent-permit count, and storm proximity. Pure dormant-
           * data unlock — no vendor calls, no scoring change. Section
           * hides itself entirely when no signals are available. */}
          <PropertyContextSection data={contextData} isLoading={contextLoading} />

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
              expandedDescriptions={true}
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
             * present; fall back to the enriched full name, then lead.owner.
             * Provenance chip shows the orchestrator's `contact_source` —
             * "via FL voter file", "via Apollo", etc. — so contractors can
             * see how the homeowner record was assembled (transparency
             * per CLAUDE.md wedge #2). */}
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
                  <ProvenanceChip source={lead.contactSource} />
                </>
              );
            })()}

            {/* Co-owner */}
            {(lead.coOwner || enrichment?.co_owner) && (
              <p className="text-[11px] text-muted-foreground pl-[18px]">
                Co-owner: {enrichment?.co_owner ?? lead.coOwner}
              </p>
            )}

            {/* Phone — provenance chip shares the lead's primary contactSource
             * because per-field source attribution isn't plumbed through
             * the API yet. When the orchestrator's full sources map lands
             * in /api/enrichment/property, swap to a per-field chip. */}
            {lead.phone && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span>{lead.phone}</span>
                </div>
                <ProvenanceChip source={lead.contactSource} />
              </>
            )}

            {/* Email */}
            {lead.email && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{lead.email}</span>
                </div>
                <ProvenanceChip source={lead.contactSource} />
              </>
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

            {/* Property Details — always visible when data exists
             * (height gate removed 2026-04-26 — user audit). Property
             * info is critical for sales reps; hiding it behind a
             * "drag taller" gesture is friction with no payoff. */}
            {(enrichment || lead.propertyValue || lead.yearBuilt) && (
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

            {/* ── Contractor / Business section (migration 00044) ──
             *
             * Renders when ANY of the orchestrator's business-side
             * enrichment fields are populated. Distinct from the
             * "Homeowner" block above — this surfaces the contractor's
             * own contact info pulled from CSLB / Google Places / Yelp
             * / OpenCorporates / PPP. Useful when the lead's permit
             * has a contractor_name and the user wants to coordinate
             * with the GC instead of the homeowner.
             */}
            {(lead.businessPhone || lead.licenseNumber || lead.businessWebsite ||
              lead.businessStatus || lead.naicsCode || lead.employer || lead.occupation) && (
              <div className="mt-2.5 pt-2 border-t border-border space-y-1">
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Contractor / Business
                </h3>

                {lead.businessPhone && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="text-foreground">{lead.businessPhone}</span>
                    <span className="text-[10px]">(business)</span>
                  </div>
                )}

                {lead.businessWebsite && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0" />
                    <a
                      href={lead.businessWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate"
                    >
                      {lead.businessWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </div>
                )}

                {lead.licenseNumber && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">License #</span>
                    <span className="text-foreground font-mono text-[10px]">
                      {lead.licenseNumber}
                      {lead.licenseStatus && (
                        <span
                          className={cn(
                            "ml-1.5 px-1 py-0.5 rounded text-[9px] font-semibold",
                            /active/i.test(lead.licenseStatus)
                              ? "bg-success/10 text-success"
                              : "bg-warning/10 text-warning",
                          )}
                        >
                          {lead.licenseStatus}
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {lead.businessStatus && lead.businessStatus !== "OPERATIONAL" && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Business status</span>
                    <span className="text-warning font-medium">
                      {lead.businessStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                )}

                {lead.naicsCode && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">NAICS</span>
                    <span className="text-foreground font-mono text-[10px]">{lead.naicsCode}</span>
                  </div>
                )}

                {lead.employer && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Employer</span>
                    <span className="text-foreground truncate max-w-[120px]" title={lead.employer}>
                      {lead.employer}
                    </span>
                  </div>
                )}

                {lead.occupation && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Occupation</span>
                    <span className="text-foreground truncate max-w-[120px]" title={lead.occupation}>
                      {lead.occupation}
                    </span>
                  </div>
                )}

                {lead.contactSource && (
                  <p className="text-[9px] text-muted-foreground mt-1 italic">
                    via {lead.contactSource.replace(/_/g, " ")}
                    {typeof lead.contactConfidence === "number" &&
                      ` (${Math.round(lead.contactConfidence * 100)}% conf)`}
                  </p>
                )}
              </div>
            )}

            {/* Permit status badge — always visible when permit data exists
             * (height gate removed 2026-04-26 — user audit) */}
            {lead.permitNumber && (
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
