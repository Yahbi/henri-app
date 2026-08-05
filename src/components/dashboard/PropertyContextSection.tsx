"use client";

import { useMemo } from "react";
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
  ShieldAlert,
  Waves,
  AlertTriangle,
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
 * Renders nothing when the lead genuinely has no derivable signals, but
 * a FAILED fetch gets its own alert branch — silently vanishing made a
 * dead request indistinguishable from an empty property.
 */

interface Props {
  data: LeadContextData | null;
  isLoading: boolean;
  /** `useLeadContext().error` — true when the context fetch failed.
   *  Optional so a caller that hasn't wired it yet still compiles; the
   *  section falls back to its old silent-null behaviour when omitted. */
  error?: boolean;
  /** `useLeadContext().refetch` — powers the retry in the alert branch. */
  onRetry?: () => void;
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

export function PropertyContextSection({ data, isLoading, error = false, onRetry }: Props) {
  // Hook declared at the top so it precedes every conditional early
  // return below — `react-hooks/rules-of-hooks` requires the same hook
  // call order on every render. `now` is captured once per mount and
  // used by the `daysAgo` label helper for SWDI / lien timestamps.
  // eslint-disable-next-line react-hooks/purity -- Date.now is captured exactly once per mount via useMemo with empty deps array; output is idempotent across re-renders. Rule is overcautious for this snapshot pattern.
  const now = useMemo(() => Date.now(), []);

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

  // Distinct from the `!data` fallback below: that one means "this
  // property has nothing worth showing", this one means "we never found
  // out". Collapsing the two hid outages behind a plausible-looking
  // empty drawer. Same split as PermitHistorySection's error branch.
  if (error) {
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
        <div role="alert" className="flex items-center gap-2 text-[11px]">
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
          <span className="text-destructive">
            Couldn&apos;t load property context.
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-auto text-[10px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              Retry
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { derived, adjacent_count_90d, storm } = data;
  const swdiNearby = data.swdi_nearby ?? [];
  const recentLiens = data.recent_liens ?? [];
  const nriRisk = data.nri_risk ?? null;
  const nfipHistory = data.nfip_history ?? null;
  const recentDisasters = data.recent_disasters ?? [];

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
  const hasNri = nriRisk != null && nriRisk.risk_score >= 50; // skip "Very Low" — visual noise
  const hasNfip = nfipHistory != null && nfipHistory.claim_count > 0;
  const hasDisasters = recentDisasters.length > 0;
  const anySignal =
    hasRoof || hasHvac || hasPool || hasSolar || hasPanel ||
    hasNeighbors || hasStorm || hasSwdi || hasLiens ||
    hasNri || hasNfip || hasDisasters;
  if (!anySignal) return null;
  const daysAgo = (iso: string): string => {
    const ms = now - new Date(iso).getTime();
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

        {/* Wave 2.A — FEMA NRI risk tier for the lead's county.
            Renders only when the matched county is at moderate risk
            or higher (>=50/100). High-risk areas drive recurring
            storm-claim work — useful contractor signal. */}
        {hasNri && nriRisk && (
          <li className="border-t border-border/40 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldAlert className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                FEMA disaster risk
              </span>
            </div>
            <div className="ml-4 flex items-center gap-2 text-[11px]">
              <span className="text-foreground font-medium">
                {nriRisk.risk_rating || "Score"}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide ${
                  nriRisk.risk_score >= 90
                    ? "bg-red-500/10 text-red-600 border border-red-500/20"
                    : nriRisk.risk_score >= 75
                      ? "bg-orange-500/10 text-orange-700 border border-orange-500/20"
                      : "bg-amber-500/10 text-amber-700 border border-amber-500/20"
                }`}
              >
                NRI {Math.round(nriRisk.risk_score)}/100
              </span>
              <span className="text-fg-subtle/60 text-[10px] ml-auto italic">
                {nriRisk.matched_on}
              </span>
            </div>
          </li>
        )}

        {/* Wave 2.B — NFIP flood-claim history for the lead's ZIP.
            Restoration-trade signal. High counts mean recurring
            flood damage — homeowner already knows to call someone. */}
        {hasNfip && nfipHistory && (
          <li className="border-t border-border/40 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Waves className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                NFIP flood-claim history
              </span>
            </div>
            <div className="ml-4 flex items-center gap-2 text-[11px]">
              <span className="text-foreground font-medium">
                {nfipHistory.claim_count.toLocaleString()} claim
                {nfipHistory.claim_count === 1 ? "" : "s"} in ZIP
              </span>
              {nfipHistory.latest_year != null && (
                <span className="text-fg-subtle/70 text-[10px]">
                  most recent {nfipHistory.latest_year}
                </span>
              )}
              {nfipHistory.claim_count >= 20 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide bg-cyan-500/10 text-cyan-700 border border-cyan-500/20 ml-auto">
                  HIGH
                </span>
              )}
            </div>
          </li>
        )}

        {/* Wave 2.B — recent FEMA disaster declarations affecting
            the lead's state. Last 3 years, top 5 by date desc.
            Useful "homeowner just got disaster $$" signal. */}
        {hasDisasters && (
          <li className="border-t border-border/40 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Recent FEMA declarations
              </span>
            </div>
            <ul className="space-y-1 ml-4">
              {recentDisasters.slice(0, 5).map((d, i) => {
                const days = d.declaration_date
                  ? daysAgo(`${d.declaration_date.slice(0, 10)}T00:00:00Z`)
                  : "";
                return (
                  <li key={`${d.fema_id}-${i}`} className="flex items-center gap-2 text-[11px]">
                    <AlertTriangle className="h-3 w-3 text-amber-600/80 shrink-0" />
                    <span className="text-foreground font-medium truncate max-w-[55%]">
                      {d.incident_type ?? d.declaration_title ?? `Disaster #${d.disaster_number ?? "?"}`}
                    </span>
                    {d.declaration_type && (
                      <span className="text-fg-subtle/70 text-[10px]">
                        {d.declaration_type}-{d.disaster_number ?? "?"}
                      </span>
                    )}
                    <span className="text-fg-subtle/60 text-[10px] ml-auto italic">
                      {days}
                    </span>
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
