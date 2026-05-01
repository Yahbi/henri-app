"use client";

import {
  Loader2,
  Home,
  Wrench,
  Zap,
  Droplets,
  Sun,
  Users,
  CloudRain,
  CloudHail,
  Tornado,
  Wind,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { LeadContextData } from "@/hooks/useLeadContext";

/**
 * Property Context — Phase 0 of free-tier data expansion.
 *
 * Renders three layers of dormant signals that Henri already has on
 * hand but never previously surfaced in the drawer:
 *
 *   1. Equipment / presence — roof age, HVAC age, pool, solar, panel.
 *      All derived purely from permit history + year_built (no vendor
 *      calls, no per-record cost). Color-coded by replacement window
 *      ("due" red, "approaching" amber, "fresh" green).
 *
 *   2. Neighborhood activity — count of OTHER permits filed in the
 *      same ZIP within 90 days before this permit. Drives outreach
 *      hooks like "5 of your neighbors just remodeled."
 *
 *   3. Storm proximity — most recent NOAA storm event in same ZIP
 *      within 60 days before the permit. Insurance-claim signal for
 *      roofing / siding / windows trades.
 *
 * Pure presentational component. State + fetch live in `useLeadContext`.
 * Renders nothing when data is null — silent fallback for the case
 * where the API errored, the views aren't applied yet, or the lead has
 * no derivable signals.
 */

interface Props {
  data: LeadContextData | null;
  isLoading: boolean;
}

function windowChip(window: "due" | "approaching" | "fresh"): {
  cls: string;
  label: string;
} {
  switch (window) {
    case "due":
      return {
        cls: "bg-red-500/10 text-red-600 border border-red-500/20",
        label: "DUE",
      };
    case "approaching":
      return {
        cls: "bg-amber-500/10 text-amber-700 border border-amber-500/20",
        label: "SOON",
      };
    case "fresh":
      return {
        cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
        label: "FRESH",
      };
  }
}

function panelLabel(estimate: "likely-undersized" | "likely-modernized" | "unknown"): {
  text: string;
  cls: string;
} | null {
  if (estimate === "likely-undersized") {
    return {
      text: "Likely undersized",
      cls: "bg-red-500/10 text-red-600 border border-red-500/20",
    };
  }
  if (estimate === "likely-modernized") {
    return {
      text: "Likely modernized",
      cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
    };
  }
  return null;
}

export function PropertyContextSection({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <section
        className="rounded-lg border border-border bg-card/50 px-3 py-2.5"
        aria-label="Property context"
      >
        <header className="flex items-center gap-1.5 mb-2">
          <Home className="h-3 w-3 text-muted-foreground" />
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Property context
          </h3>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </header>
      </section>
    );
  }

  if (!data) return null;

  const { derived, adjacent_count_90d, storm } = data;
  const swdiNearby = data.swdi_nearby ?? [];
  const recentLiens = data.recent_liens ?? [];

  // Decide whether to render anything at all. Hide the entire section if
  // we have zero useful signals (avoid empty-card noise on leads with no
  // permit history + no storms + no neighbors).
  const hasRoof = derived.roof_age != null;
  const hasHvac = derived.hvac_age != null;
  const hasPool = derived.pool.present;
  const hasSolar = derived.solar.present;
  const hasPanel = derived.panel_age.estimate !== "unknown";
  const hasNeighbors = adjacent_count_90d > 0;
  const hasStorm = storm != null;
  const hasSwdi = swdiNearby.length > 0;
  const hasLiens = recentLiens.length > 0;
  const anySignal =
    hasRoof || hasHvac || hasPool || hasSolar || hasPanel ||
    hasNeighbors || hasStorm || hasSwdi || hasLiens;
  if (!anySignal) return null;

  /** Days-ago label for SWDI / lien event timestamps (UTC). */
  const daysAgo = (iso: string): string => {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    const days = Math.round(ms / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    return `${days}d ago`;
  };

  return (
    <section
      className="rounded-lg border border-border bg-card/50 px-3 py-2.5"
      aria-label="Property context"
    >
      <header className="flex items-center gap-1.5 mb-2">
        <Home className="h-3 w-3 text-muted-foreground" />
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Property context
        </h3>
      </header>

      <ul className="space-y-1.5">
        {hasRoof && derived.roof_age && (
          <li className="flex items-center gap-2 text-[11px]">
            <Home className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Roof:</span>
            <span className="text-foreground font-medium">
              {derived.roof_age.years_since}y
            </span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide",
                windowChip(derived.roof_age.replacement_window).cls,
              )}
            >
              {windowChip(derived.roof_age.replacement_window).label}
            </span>
            <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
              from {derived.roof_age.derived_from}
            </span>
          </li>
        )}

        {hasHvac && derived.hvac_age && (
          <li className="flex items-center gap-2 text-[11px]">
            <Wrench className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">HVAC:</span>
            <span className="text-foreground font-medium">
              {derived.hvac_age.years_since}y
            </span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide",
                windowChip(derived.hvac_age.replacement_window).cls,
              )}
            >
              {windowChip(derived.hvac_age.replacement_window).label}
            </span>
            <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
              from {derived.hvac_age.derived_from}
            </span>
          </li>
        )}

        {hasPanel && panelLabel(derived.panel_age.estimate) && (
          <li className="flex items-center gap-2 text-[11px]">
            <Zap className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Panel:</span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide",
                panelLabel(derived.panel_age.estimate)!.cls,
              )}
            >
              {panelLabel(derived.panel_age.estimate)!.text}
            </span>
            {derived.panel_age.last_electrical_year != null && (
              <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
                last electrical {derived.panel_age.last_electrical_year}
              </span>
            )}
          </li>
        )}

        {hasPool && (
          <li className="flex items-center gap-2 text-[11px]">
            <Droplets className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Pool:</span>
            <span className="text-foreground font-medium">Present</span>
            {derived.pool.pool_year && (
              <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
                {derived.pool.source === "current-permit"
                  ? "this permit"
                  : `since ${derived.pool.pool_year}`}
              </span>
            )}
          </li>
        )}

        {hasSolar && (
          <li className="flex items-center gap-2 text-[11px]">
            <Sun className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Solar:</span>
            <span className="text-foreground font-medium">Present</span>
            {derived.solar.solar_year && (
              <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
                {derived.solar.years_since != null
                  ? `${derived.solar.years_since}y old`
                  : `since ${derived.solar.solar_year}`}
              </span>
            )}
          </li>
        )}

        {hasNeighbors && (
          <li className="flex items-center gap-2 text-[11px]">
            <Users className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Neighborhood:</span>
            <span className="text-foreground font-medium">
              {adjacent_count_90d} other permit{adjacent_count_90d === 1 ? "" : "s"}
            </span>
            <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
              ZIP within 90d
            </span>
          </li>
        )}

        {hasStorm && storm && (
          <li className="flex items-center gap-2 text-[11px]">
            <CloudRain className="h-3 w-3 text-muted-foreground/70 shrink-0" />
            <span className="text-fg-subtle">Storm:</span>
            <span className="text-foreground font-medium">{storm.type}</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide bg-amber-500/10 text-amber-700 border border-amber-500/20">
              {storm.days_between}d before permit
            </span>
            {storm.magnitude != null && (
              <span className="text-fg-subtle/70 text-[10px] ml-auto italic">
                mag {storm.magnitude}
              </span>
            )}
          </li>
        )}

        {/* Wave 1.5 — recent NOAA SWDI radar signatures within 25mi/30d.
            Distinct from `storm` above which is the curated NOAA Storm
            Events ground-truth match for the lead's permit. SWDI is the
            radar firehose; multiple per lead is expected. */}
        {hasSwdi && (
          <li className="border-t border-border/40 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <CloudHail className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Recent storm signatures (25mi · 30d)
              </span>
            </div>
            <ul className="space-y-1 ml-4">
              {swdiNearby.map((s, i) => {
                const Icon =
                  s.kind === "tornado" ? Tornado : s.kind === "wind" ? Wind : CloudHail;
                let detail = "";
                if (s.kind === "hail" && s.max_size_mm != null) {
                  detail = `${(s.max_size_mm / 25.4).toFixed(2)} in hail`;
                } else if (s.kind === "wind" && s.max_wind_mph != null) {
                  detail = `${Math.round(s.max_wind_mph)} mph`;
                } else if (s.kind === "tornado") {
                  detail = "Tornado vortex signature";
                }
                return (
                  <li
                    key={`${s.kind}-${s.event_time}-${i}`}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <Icon className="h-3 w-3 text-amber-600/80 shrink-0" />
                    <span className="text-foreground font-medium capitalize">
                      {s.kind}
                    </span>
                    {detail && (
                      <span className="text-fg-subtle/70 text-[10px]">
                        {detail}
                      </span>
                    )}
                    <span className="text-fg-subtle/60 text-[10px] ml-auto italic">
                      {s.miles_away}mi · {daysAgo(s.event_time)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        )}

        {/* Wave 1.5 — recent CourtListener mechanic-lien dockets. Soft
            payment-distress signal in the area. Renders as scrollable
            dockets with link to courtlistener.com when available. */}
        {hasLiens && (
          <li className="border-t border-border/40 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Scale className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Payment-distress filings nearby (90d)
              </span>
            </div>
            <ul className="space-y-1 ml-4">
              {recentLiens.map((l, i) => {
                const inner = (
                  <>
                    <Scale className="h-3 w-3 text-rose-600/80 shrink-0" />
                    <span className="text-foreground font-medium truncate max-w-[55%]">
                      {l.case_name ?? l.docket_number ?? "Mechanic lien"}
                    </span>
                    <span className="text-fg-subtle/60 text-[10px] ml-auto italic">
                      {l.date_filed ? daysAgo(`${l.date_filed}T00:00:00Z`) : ""}
                    </span>
                  </>
                );
                return (
                  <li key={`${l.docket_number ?? "lien"}-${i}`} className="text-[11px]">
                    {l.absolute_url ? (
                      <a
                        href={`https://www.courtlistener.com${l.absolute_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 hover:underline"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        )}
      </ul>
    </section>
  );
}
