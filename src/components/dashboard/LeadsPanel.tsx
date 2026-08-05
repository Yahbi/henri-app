"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, EyeOff, Bookmark, Building2 } from "lucide-react";
import { LeadCard, type LeadData } from "./LeadCard";
import { useExclusivity } from "@/hooks/useExclusivity";
import { useCapacityPrefs } from "@/hooks/useCapacityPrefs";
import { useHiddenLeads } from "@/hooks/useHiddenLeads";
import { useSavedLeads } from "@/hooks/useSavedLeads";
import { applyCapacityFilter, hasActivePrefs } from "@/lib/capacity/types";
import { CapacityFilterBar } from "./CapacityFilterBar";

/** Average card height in px — LeadCard actually renders at 95–105px once
 * the badge row + permit-age line + optional description are all present.
 * Set to 112 so adjacent absolutely-positioned rows never collide (the
 * earlier 72 caused visual overlap on real-data cards). Each row also has
 * `overflow: hidden` as a safety net for any edge-case overrun. */
const CARD_HEIGHT = 112;
/** Extra rows rendered above/below the viewport as a scroll buffer. */
const OVERSCAN = 8;

type FilterType =
  | "all"
  | "hot"
  | "warm"
  | "cool"
  | "cascade"
  | "homeowner"
  // Phase AA — saved-leads filter. Mirrors the show-hidden toggle but
  // as a positive filter (i.e. show ONLY leads in saved_leads).
  | "saved"
  // Module 1 (2026-05-09) — intent-stage filter values. Drive the
  // `opportunityStage` filter on the LeadsPanel. Each maps 1:1 to the
  // 11 allowed `opportunity_stage` values from src/lib/intent/reason-codes.ts.
  | "stage_pre_intent"
  | "stage_permit_no_contractor"
  | "stage_stalled_expired"
  | "stage_maintenance"
  | "stage_subcontractor";
type SortType = "score" | "newest" | "value";

interface LeadsPanelProps {
  leads: LeadData[];
  activeLead: LeadData | null;
  onSelectLead: (lead: LeadData) => void;
  /** Collapsed state — when true render the thin rail. */
  collapsed?: boolean;
  /** Called when the user clicks the collapse/expand chevron. */
  onToggleCollapsed?: () => void;
  /** Total geocoded leads available for this contractor (cap-transparency). */
  totalGeocoded?: number;
  /** Leads hidden by the server-side `geocoded_only` filter (no lat/lng
   *  yet, so they can't render on the map). Computed by the parent via
   *  `countHiddenByGeocodeFilter` in useLeads.helpers. When > 0 a muted
   *  "N leads hidden (no map location yet)" line renders below the
   *  filter row — same "never silently drop rows" contract as the
   *  capacity filter bar. */
  hiddenNonGeocoded?: number;
}

/* Filter dot colours — fed to inline `style={{ background: f.dot }}` so
 * we use CSS `var()` references that resolve through globals.css.
 * Migrated from raw hex literals on 2026-04-25 per design-system audit
 * priority action #4. */
const FILTERS: { value: FilterType; label: string; dot?: string }[] = [
  { value: "all",       label: "All leads",          dot: "var(--hot)" },
  { value: "hot",       label: "Hot (75+)",          dot: "var(--hot)" },
  { value: "warm",      label: "Warm (50-74)",       dot: "var(--warm)" },
  { value: "cool",      label: "Cool (<50)",         dot: "var(--cool)" },
  { value: "cascade",   label: "Cascade only" },
  { value: "homeowner", label: "Homeowner requests" },
  { value: "saved",     label: "Saved" },
  // Module 1 (2026-05-09) — opportunity-stage filters. Live alongside
  // the existing urgency/cascade filters. Each one maps to one or more
  // values of `opportunity_stage` written by the intent classifier.
  { value: "stage_pre_intent",          label: "Pre-intent" },
  { value: "stage_permit_no_contractor", label: "Permit, no contractor" },
  { value: "stage_stalled_expired",      label: "Stalled / expired" },
  { value: "stage_maintenance",          label: "Maintenance opportunities" },
  { value: "stage_subcontractor",        label: "Subcontractor opportunity" },
];

/* Sort options — fed to the custom popover. Was a native <select>
 * until 2026-04-26; the open panel rendered with OS chrome (white
 * in dusk/dark). Custom popover uses theme tokens correctly. */
const SORT_OPTIONS: { value: SortType; label: string }[] = [
  { value: "score",  label: "Score" },
  { value: "newest", label: "Newest" },
  { value: "value",  label: "Value" },
];

function formatTotalValue(total: number): string {
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `$${Math.round(total / 1_000)}K`;
  if (total > 0) return `$${total}`;
  return "$0";
}

export function LeadsPanel({
  leads,
  activeLead,
  onSelectLead,
  collapsed,
  onToggleCollapsed,
  totalGeocoded,
  hiddenNonGeocoded = 0,
}: LeadsPanelProps) {
  // Hooks MUST all run on every render (rules-of-hooks). Declare them
  // before the `if (collapsed) return …` early-exit so the collapsed
  // and expanded render paths agree on hook order.
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("score");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Close the filter/sort popovers on outside click. Same inline
  // mousedown-listener pattern as TopBar / NotificationDropdown /
  // MapStyleSwitcher (no shared useClickOutside hook exists yet).
  // One listener handles both popovers; attached only while one is open.
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  // Trigger refs so selecting an option (which unmounts the button that was
  // just clicked) can hand focus back instead of dropping it to <body>.
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filterOpen && !sortOpen) return;
    function handleOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (filterRef.current && !filterRef.current.contains(t)) {
        setFilterOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(t)) {
        setSortOpen(false);
      }
    }
    // Escape dismisses without committing a change — previously the only
    // non-mouse way out of an open popover was to pick an option.
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (filterOpen) {
        setFilterOpen(false);
        filterTriggerRef.current?.focus();
      }
      if (sortOpen) {
        setSortOpen(false);
        sortTriggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [filterOpen, sortOpen]);
  // Module 8 — show-hidden toggle. Defaults to false so hidden leads
  // disappear from the panel; the contractor can flip it on to audit
  // what they've hidden.
  const [showHidden, setShowHidden] = useState(false);
  // Property-type filter — hide leads confidently classified commercial
  // (a hospital's tenant improvement etc.). Off by default; opt-in, and the
  // pill below shows how many are being held back (never a silent drop). Only
  // `commercial` rows are removed — residential AND unknown always stay.
  const [hideCommercial, setHideCommercial] = useState(false);

  // Phase 0a: fetch exclusivity locks for every rendered lead. Returns
  // an empty map when migration 00031 isn't applied — no visual change
  // in that case (badges simply don't render).
  const leadIdsForLocks = useMemo(() => leads.map((l) => l.id), [leads]);
  const { locks } = useExclusivity(leadIdsForLocks);

  // Module 8 — hidden_leads ids for the current contractor. Empty set
  // when migration 00090 isn't applied or no leads have been hidden.
  const { hiddenIds } = useHiddenLeads();

  // Phase AA — saved_leads ids. Used both by the "Saved" filter case
  // below (positive filter: show ONLY saved) AND for the optional
  // bookmark indicator on the lead card row.
  const { savedIds } = useSavedLeads();

  // Phase 0a: capacity filter (wedge #7). Pulls preferences from the
  // Settings → Capacity page and hides leads outside the contractor's
  // working envelope. Never silently drops rows — the filter bar
  // always shows how many are being held back + a one-click clear.
  const { prefs: capacity, clear: clearCapacity } = useCapacityPrefs();

  // All remaining hooks MUST run before the collapsed early-return.
  const filtered = useMemo(() => {
    // Module 8 — strip hidden leads up front unless the user has
    // toggled "Show hidden" on. This runs BEFORE every other filter so
    // capacity counters reflect the post-hide universe.
    let result = showHidden
      ? [...leads]
      : leads.filter((l) => !hiddenIds.has(l.id));

    // Property-type exclusion — drop only rows we're CONFIDENT are commercial;
    // residential + unknown always pass. Composes with every other filter.
    if (hideCommercial) {
      result = result.filter((l) => l.propertyType !== "commercial");
    }

    // Text search across address, owner name, and description
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (l) =>
          l.addr.toLowerCase().includes(q) ||
          l.owner.toLowerCase().includes(q) ||
          (l.permitDescription ?? "").toLowerCase().includes(q)
      );
    }

    switch (filter) {
      case "hot": result = result.filter((l) => l.score >= 75); break;
      case "warm": result = result.filter((l) => l.score >= 50 && l.score < 75); break;
      case "cool": result = result.filter((l) => l.score < 50); break;
      case "cascade": result = result.filter((l) => l.cascade); break;
      case "homeowner": result = result.filter((l) => l.isHomeowner); break;
      // Phase AA — saved-leads filter. Positive filter — shows ONLY
      // leads in saved_leads. Pairs with the Save button in the
      // drawer (LeadActionButtons → /api/leads/[id]/save).
      case "saved": result = result.filter((l) => savedIds.has(l.id)); break;
      // Module 1 (2026-05-09) — intent-stage filter cases. Each matches
      // one or more of the 11 `opportunity_stage` values written by the
      // classifier. The "subcontractor" filter looks at reason codes
      // because the stage is `permit_filed_with_contractor` or
      // `project_moving` either of which can imply a sub opportunity.
      case "stage_pre_intent":
        result = result.filter((l) => l.opportunityStage === "pre_intent");
        break;
      case "stage_permit_no_contractor":
        result = result.filter((l) => l.opportunityStage === "permit_filed_no_contractor");
        break;
      case "stage_stalled_expired":
        result = result.filter((l) =>
          l.opportunityStage === "stalled" || l.opportunityStage === "expired");
        break;
      case "stage_maintenance":
        result = result.filter((l) => l.opportunityStage === "maintenance_upsell");
        break;
      case "stage_subcontractor":
        result = result.filter((l) =>
          (l.reasonCodes ?? []).includes("subcontractor_opportunity"));
        break;
    }

    switch (sort) {
      case "score": result.sort((a, b) => b.score - a.score); break;
      case "newest": result.sort((a, b) => (a.permitAge ?? 0) - (b.permitAge ?? 0)); break;
      // Sort on the numeric field, not the abbreviated display string.
      // `value` is formatted by formatCurrency, which puts the magnitude in
      // the SUFFIX ("$2.5M", "$450K"); stripping non-digits turned those
      // into 2.5 and 450, so million-dollar permits sorted below $1k ones.
      case "value":
        result.sort((a, b) => (b.rawValue ?? 0) - (a.rawValue ?? 0));
        break;
    }

    return result;
  }, [leads, filter, sort, search, hiddenIds, showHidden, hideCommercial, savedIds]);

  // Module 8 — count of leads currently being hidden (for the toggle pill).
  const hiddenCount = useMemo(
    () => leads.filter((l) => hiddenIds.has(l.id)).length,
    [leads, hiddenIds],
  );

  // Phase AA — count of saved leads in the current `leads` set
  // (used by the "Saved (N)" pill below the filter dropdown).
  const savedCount = useMemo(
    () => leads.filter((l) => savedIds.has(l.id)).length,
    [leads, savedIds],
  );

  // Count of confidently-commercial leads in the post-hidden universe — drives
  // the "Exclude commercial" pill (only shown when there's something to hide).
  const commercialCount = useMemo(() => {
    const base = showHidden ? leads : leads.filter((l) => !hiddenIds.has(l.id));
    return base.filter((l) => l.propertyType === "commercial").length;
  }, [leads, hiddenIds, showHidden]);

  // Phase 0a — apply capacity filter AFTER urgency/trade/sort so the
  // "N filtered out" count is computed against what the contractor would
  // otherwise see. Displayed in the filter bar; never silently hides.
  const capacityFiltered = useMemo(
    () => applyCapacityFilter(filtered, capacity),
    [filtered, capacity],
  );
  const filteredOutByCapacity = filtered.length - capacityFiltered.length;

  const totalValue = useMemo(() => {
    return capacityFiltered.reduce((sum, l) => sum + (l.rawValue ?? 0), 0);
  }, [capacityFiltered]);

  /* ── Address-collision detection ──
   *
   * One permit can back multiple leads (one per trade slot) per wedge
   * contract #1. When that happens, two cards in the leads list show
   * identical summary text (same address, city, sometimes same trade
   * badges if the trades overlap into a superset like "Cascade · general
   * · commercial"). Without disambiguation the user can't tell which
   * card is which, even though they're genuinely distinct lead rows.
   *
   * This memo builds a Set of `fullAddress` strings that appear more
   * than once in the currently-rendered list. `LeadCard` checks this
   * set and appends a trade + permit-UUID suffix chip when it's a
   * collision — visible disambiguation without cluttering the common
   * case (one lead per address). */
  const collidingAddresses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of capacityFiltered) {
      const key = l.fullAddress || l.addr;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const set = new Set<string>();
    for (const [key, count] of counts) {
      if (count > 1) set.add(key);
    }
    return set;
  }, [capacityFiltered]);

  // Collapsed rail: only the expand button + a count badge. Consumes the
  // parent-provided narrow width so the map gets the rest of the screen.
  if (collapsed) {
    return (
      /* Same complementary landmark as the expanded form so keyboard
       * users don't lose the panel when it collapses. aria-label hints
       * that it's collapsed so screen readers announce state. */
      <aside
        role="complementary"
        aria-label="Leads list (collapsed)"
        className="flex flex-col items-center justify-start h-full bg-card border-r border-border py-3 gap-3"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand leads panel"
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
        <div
          className="writing-mode-vertical text-[11px] font-medium text-muted-foreground rotate-180 select-none"
          style={{ writingMode: "vertical-rl" }}
        >
          {leads.length} lead{leads.length === 1 ? "" : "s"}
        </div>
      </aside>
    );
  }

  const activeFilter = FILTERS.find((f) => f.value === filter)!;

  return (
    /* `<aside role="complementary">` + aria-label so screen readers can
     * jump between the map, the leads panel, and the detail drawer with
     * a single landmark keypress (H / D in NVDA, VoiceOver rotor). The
     * panel is semantically a complement to the map, not a navigation
     * structure — `<aside>` is the correct landmark. */
    <aside
      role="complementary"
      aria-label="Leads list"
      className="flex flex-col h-full bg-card border-r border-border"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {/* aria-live so filter / search changes announce the new count —
             * the virtualized list only ever has ~26 rows in the DOM, so this
             * badge is the only place the true total is conveyed. */}
            Leads <span aria-live="polite" className="text-xs font-normal text-primary bg-primary-10 px-1.5 py-0.5 rounded-full ml-1">{capacityFiltered.length.toLocaleString()}</span>
            {totalGeocoded && totalGeocoded > leads.length && (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                of {totalGeocoded.toLocaleString()}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {totalValue > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {formatTotalValue(totalValue)} total
              </span>
            )}
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Collapse leads panel"
                className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors -mr-1"
              >
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address, owner, description..."
            aria-label="Search leads by address, owner, or description"
            className="w-full text-xs bg-bg-subtle border border-border rounded-lg pl-8 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Filter + Sort row */}
        <div className="flex items-center gap-2 mt-2">
          {/* Filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              ref={filterTriggerRef}
              onClick={() => setFilterOpen(!filterOpen)}
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
            >
              {activeFilter.dot && (
                <span className="w-2 h-2 rounded-full" style={{ background: activeFilter.dot }} />
              )}
              {activeFilter.label}
              <span className="text-muted-foreground ml-0.5">{filtered.length}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {filterOpen && (
              /* role="menu" + menuitemradio matches what's actually rendered
               * (plain buttons). The trigger previously advertised a listbox
               * that never existed, and no option carried a selected state. */
              <div
                role="menu"
                aria-label="Filter leads"
                className="absolute top-full left-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-30 py-1"
              >
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={f.value === filter}
                    onClick={() => {
                      setFilter(f.value);
                      setFilterOpen(false);
                      // The clicked button unmounts with the popover — hand
                      // focus back to the trigger instead of losing it.
                      filterTriggerRef.current?.focus();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    {f.dot && <span className="w-2 h-2 rounded-full" style={{ background: f.dot }} />}
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Module 8 — show-hidden toggle. Renders only when the
              contractor has actually hidden ≥1 lead (otherwise it's
              dead UI). Click to flip; pill colour follows on/off. */}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showHidden
                  ? "border-primary/40 bg-primary-10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent"
              }`}
              title={showHidden ? "Hide them again" : `Show ${hiddenCount} hidden lead${hiddenCount === 1 ? "" : "s"}`}
              aria-pressed={showHidden}
            >
              <EyeOff className="h-3 w-3" />
              {showHidden ? `Hiding revealed (${hiddenCount})` : `${hiddenCount} hidden`}
            </button>
          )}

          {/* Phase AA — saved-leads quick filter. Renders only when
              the contractor has actually saved ≥1 lead. Click flips
              between "all leads" and "saved only". Mirrors the
              Hide-toggle visual language so the two complete the
              save/hide pair in one toolbar slot each. */}
          {savedCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter((f) => (f === "saved" ? "all" : "saved"))}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filter === "saved"
                  ? "border-primary/40 bg-primary-10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent"
              }`}
              title={filter === "saved" ? "Show all leads again" : `Show only ${savedCount} saved lead${savedCount === 1 ? "" : "s"}`}
              aria-pressed={filter === "saved"}
            >
              <Bookmark className="h-3 w-3" />
              {filter === "saved" ? `Saved only (${savedCount})` : `${savedCount} saved`}
            </button>
          )}

          {/* Property-type filter — "Exclude commercial". Renders only when
              ≥1 commercial lead is present. Opt-in; when active the pill
              itself is the "N filtered out" transparency counter. */}
          {commercialCount > 0 && (
            <button
              type="button"
              onClick={() => setHideCommercial((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                hideCommercial
                  ? "border-primary/40 bg-primary-10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent"
              }`}
              title={
                hideCommercial
                  ? `Show ${commercialCount} commercial lead${commercialCount === 1 ? "" : "s"} again`
                  : `Exclude ${commercialCount} commercial lead${commercialCount === 1 ? "" : "s"}`
              }
              aria-pressed={hideCommercial}
            >
              <Building2 className="h-3 w-3" />
              {hideCommercial
                ? `Commercial hidden (${commercialCount})`
                : `${commercialCount} commercial`}
            </button>
          )}

          {/* Sort — custom popover (NOT a native select) so the open panel
           * inherits theme tokens. Native <option> elements render with
           * the OS color scheme, which produced white-on-white text in
           * dusk/dark mode. Mirrors the Filter dropdown above so both
           * controls render identically across light / dusk / dark. */}
          <div className="relative ml-auto" ref={sortRef}>
            <button
              type="button"
              ref={sortTriggerRef}
              onClick={() => setSortOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-accent transition-colors"
            >
              {SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Score"}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {sortOpen && (
              <div
                role="menu"
                aria-label="Sort leads"
                className="absolute top-full right-0 mt-1 w-32 bg-card border border-border rounded-lg shadow-lg z-30 py-1"
              >
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={o.value === sort}
                    onClick={() => {
                      setSort(o.value);
                      setSortOpen(false);
                      sortTriggerRef.current?.focus();
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-foreground"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Geocode-filter transparency — mirrors the capacity filter's
            "N filtered out" pattern. These leads exist but have no
            lat/lng yet, so the server-side geocoded_only filter holds
            them back from the map-driven panel. Never silently drop. */}
        {hiddenNonGeocoded > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {hiddenNonGeocoded.toLocaleString()} lead
            {hiddenNonGeocoded === 1 ? "" : "s"} hidden (no map location yet)
          </p>
        )}
      </div>

      {/* Phase 0a capacity filter bar — sits above the list. Shows
          "Set capacity" when inactive, or a pill summary + hidden count
          when active. Never silently drops rows. */}
      <div className="px-4 py-1.5 border-b border-border flex items-center gap-2">
        <CapacityFilterBar
          prefs={capacity}
          filteredOutCount={filteredOutByCapacity}
          onClear={() => clearCapacity()}
        />
      </div>

      {/* Lead list — virtualized so 2k+ cards don't freeze the scroll. */}
      <VirtualizedLeadList
        leads={capacityFiltered}
        activeLead={activeLead}
        onSelectLead={onSelectLead}
        emptyMessage={
          search.trim()
            ? "No leads match your search"
            : hasActivePrefs(capacity) && filteredOutByCapacity > 0
              ? `All ${filteredOutByCapacity} leads are outside your capacity envelope \u2014 widen to see them`
              : "No leads match this filter"
        }
        locks={locks}
        collidingAddresses={collidingAddresses}
        savedIds={savedIds}
      />
    </aside>
  );
}

/* ── Lightweight virtualization ─────────────────────────────────────────── */

interface VirtualListProps {
  leads: LeadData[];
  activeLead: LeadData | null;
  onSelectLead: (lead: LeadData) => void;
  emptyMessage: string;
  /** Phase 0a: lock + watcher summaries keyed by lead_id. Empty when
   *  feature inactive (migration 00031 not applied). Cards render no
   *  badges in that case. Each summary carries both the caller's lock
   *  state AND the coarse wedge-#6 watcher bucket. */
  locks: Record<string, import("@/lib/exclusivity/locks").ExclusivityLeadSummary>;
  /** Addresses that appear more than once in `leads` — their LeadCards
   *  render a trade + permit-UUID disambiguation suffix. See the
   *  address-collision memo in the parent. */
  collidingAddresses: Set<string>;
  /** Phase AA — set of lead ids the contractor has saved. Drives the
   *  inline bookmark indicator on each card. Empty set when migration
   *  00090 isn't applied or no rows saved (no visual change). */
  savedIds: Set<string>;
}

function VirtualizedLeadList({ leads, activeLead, onSelectLead, emptyMessage, locks, collidingAddresses, savedIds }: VirtualListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const handleClick = useCallback(
    (lead: LeadData) => onSelectLead(lead),
    [onSelectLead],
  );

  const total = leads.length;
  const totalHeight = total * CARD_HEIGHT;
  const first = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewport / CARD_HEIGHT) + OVERSCAN * 2;
  const last = Math.min(total, first + visibleCount);

  if (total === 0) {
    return (
      <div
      ref={scrollRef}
      /* tabIndex + a stable hook so the drawer can hand focus back here
       * after an action removes the originating card from the list
       * (see LeadDetailDrawer's onHidden). */
      tabIndex={-1}
      data-leads-scroll
      className="flex-1 overflow-y-auto scrollbar-thin"
    >
        <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      /* tabIndex + a stable hook so the drawer can hand focus back here
       * after an action removes the originating card from the list
       * (see LeadDetailDrawer's onHidden). */
      tabIndex={-1}
      data-leads-scroll
      className="flex-1 overflow-y-auto scrollbar-thin"
    >
      {/* Spacer to establish total scroll height. role="list" + per-row
       * aria-setsize/aria-posinset so assistive tech can tell "item 14 of
       * 2,000" even though only ~26 rows exist in the DOM at a time. */}
      <div role="list" style={{ height: totalHeight, position: "relative" }}>
        {/* Only render the visible slice + overscan. Each card is absolutely
         * positioned by its row index × card height. */}
        {leads.slice(first, last).map((lead, i) => (
          <div
            key={lead.id}
            data-virtual-row
            role="listitem"
            aria-setsize={total}
            aria-posinset={first + i + 1}
            style={{
              position: "absolute",
              top: (first + i) * CARD_HEIGHT,
              left: 0,
              right: 0,
              height: CARD_HEIGHT,
              overflow: "hidden",
              borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
            }}
          >
            <LeadCard
              lead={lead}
              active={activeLead?.id === lead.id}
              onClick={() => handleClick(lead)}
              exclusivity={locks[lead.id]}
              disambiguate={collidingAddresses.has(lead.fullAddress || lead.addr)}
              isSaved={savedIds.has(lead.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
