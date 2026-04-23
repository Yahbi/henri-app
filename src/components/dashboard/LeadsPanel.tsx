"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { LeadCard, type LeadData } from "./LeadCard";
import { useExclusivity } from "@/hooks/useExclusivity";
import { useCapacityPrefs } from "@/hooks/useCapacityPrefs";
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

type FilterType = "all" | "hot" | "warm" | "cool" | "cascade" | "homeowner";
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
}

const FILTERS: { value: FilterType; label: string; dot?: string }[] = [
  { value: "all", label: "All leads", dot: "#D4886A" },
  { value: "hot", label: "Hot (75+)", dot: "#D4886A" },
  { value: "warm", label: "Warm (50-74)", dot: "#D4A24A" },
  { value: "cool", label: "Cool (<50)", dot: "#4A7FC0" },
  { value: "cascade", label: "Cascade only" },
  { value: "homeowner", label: "Homeowner requests" },
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
}: LeadsPanelProps) {
  // Hooks MUST all run on every render (rules-of-hooks). Declare them
  // before the `if (collapsed) return …` early-exit so the collapsed
  // and expanded render paths agree on hook order.
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("score");
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Phase 0a: fetch exclusivity locks for every rendered lead. Returns
  // an empty map when migration 00031 isn't applied — no visual change
  // in that case (badges simply don't render).
  const leadIdsForLocks = useMemo(() => leads.map((l) => l.id), [leads]);
  const { locks } = useExclusivity(leadIdsForLocks);

  // Phase 0a: capacity filter (wedge #7). Pulls preferences from the
  // Settings → Capacity page and hides leads outside the contractor's
  // working envelope. Never silently drops rows — the filter bar
  // always shows how many are being held back + a one-click clear.
  const { prefs: capacity, clear: clearCapacity } = useCapacityPrefs();

  // Collapsed rail: only the expand button + a count badge. Consumes the
  // parent-provided narrow width so the map gets the rest of the screen.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center justify-start h-full bg-card border-r border-border py-3 gap-3">
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
      </div>
    );
  }

  const filtered = useMemo(() => {
    let result = [...leads];

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
    }

    switch (sort) {
      case "score": result.sort((a, b) => b.score - a.score); break;
      case "newest": result.sort((a, b) => (a.permitAge ?? 0) - (b.permitAge ?? 0)); break;
      case "value": {
        const parseVal = (v: string) => parseFloat(v.replace(/[^0-9.]/g, "")) || 0;
        result.sort((a, b) => parseVal(b.value) - parseVal(a.value));
        break;
      }
    }

    return result;
  }, [leads, filter, sort, search]);

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

  const activeFilter = FILTERS.find((f) => f.value === filter)!;

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            Leads <span className="text-xs font-normal text-primary bg-primary-10 px-1.5 py-0.5 rounded-full ml-1">{capacityFiltered.length.toLocaleString()}</span>
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
            className="w-full text-xs bg-bg-subtle border border-border rounded-lg pl-8 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Filter + Sort row */}
        <div className="flex items-center gap-2 mt-2">
          {/* Filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
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
              <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-30 py-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => { setFilter(f.value); setFilterOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    {f.dot && <span className="w-2 h-2 rounded-full" style={{ background: f.dot }} />}
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1 ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="text-xs bg-transparent border border-border rounded-lg px-2 py-1.5 text-muted-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="score">Score &#8595;</option>
              <option value="newest">Newest</option>
              <option value="value">Value</option>
            </select>
          </div>
        </div>
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
      />
    </div>
  );
}

/* ── Lightweight virtualization ─────────────────────────────────────────── */

interface VirtualListProps {
  leads: LeadData[];
  activeLead: LeadData | null;
  onSelectLead: (lead: LeadData) => void;
  emptyMessage: string;
  /** Phase 0a: lock summaries keyed by lead_id. Empty when feature
   *  inactive. Cards render no badge in that case. */
  locks: Record<string, import("@/lib/exclusivity/locks").ExclusivityLockSummary>;
}

function VirtualizedLeadList({ leads, activeLead, onSelectLead, emptyMessage, locks }: VirtualListProps) {
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {/* Spacer to establish total scroll height */}
      <div style={{ height: totalHeight, position: "relative" }}>
        {/* Only render the visible slice + overscan. Each card is absolutely
         * positioned by its row index × card height. */}
        {leads.slice(first, last).map((lead, i) => (
          <div
            key={lead.id}
            data-virtual-row
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}
