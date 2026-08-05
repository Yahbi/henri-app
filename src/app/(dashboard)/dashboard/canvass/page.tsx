"use client";

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { formatCurrency } from "@/types/lead";
import type { Lead } from "@/types/lead";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { ComingSoon, STUBS_ENABLED } from "@/components/ComingSoon";

/* Trade pill colours — same `--trade-*-fg` / `--trade-*-tint` token set
 * as KanbanBoard / LeadCard / jobs. Migrated from raw hex 2026-04-25. */
const TRADE_COLORS: Record<string, { bg: string; text: string }> = {
  roofing:           { bg: "bg-trade-roofing-tint",    text: "text-trade-roofing" },
  hvac:              { bg: "bg-trade-hvac-tint",       text: "text-trade-hvac" },
  plumbing:          { bg: "bg-trade-plumbing-tint",   text: "text-trade-plumbing" },
  electrical:        { bg: "bg-trade-electrical-tint", text: "text-trade-electrical" },
  solar:             { bg: "bg-trade-solar-tint",      text: "text-trade-solar" },
  adu:               { bg: "bg-trade-adu-tint",        text: "text-trade-adu" },
  "general remodel": { bg: "bg-trade-general-tint",    text: "text-trade-general" },
};

function tradeBadge(trade: string | null | undefined) {
  if (!trade) return null;
  const key = trade.toLowerCase();
  const colors = TRADE_COLORS[key] ?? { bg: "bg-trade-general-tint", text: "text-trade-general" };
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium capitalize", colors.bg, colors.text)}>
      {trade}
    </span>
  );
}

function priorityBadge(score: number) {
  if (score >= 75)
    return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">High</span>;
  if (score >= 50)
    return <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">Medium</span>;
  return <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">Low</span>;
}

/* Score-tier pill — uses the canonical `--hot`/`--warm`/`--cool` tokens
 * via the `color-mix` pattern. Same as KanbanBoard.scoreColor. */
function scoreBadge(score: number) {
  const color = score >= 75
    ? "text-hot  bg-[color-mix(in_srgb,var(--hot)_12%,transparent)]"
    : score >= 50
    ? "text-warm bg-[color-mix(in_srgb,var(--warm)_12%,transparent)]"
    : "text-cool bg-[color-mix(in_srgb,var(--cool)_12%,transparent)]";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}
    </span>
  );
}

function getTradeAction(lead: Lead): string {
  if (lead.cascade_flag) {
    return "Cascade signal -- bundle inspection with permit follow-up";
  }
  const trade = (lead.trade ?? "").toLowerCase();
  switch (trade) {
    case "roofing":
      return "Priority -- schedule roof inspection";
    case "hvac":
      return "HVAC system assessment opportunity";
    case "plumbing":
      return "Plumbing inspection follow-up";
    case "electrical":
      return "Electrical panel assessment opportunity";
    case "solar":
      return "Solar installation consultation";
    case "adu":
      return "ADU project scope and feasibility review";
    default:
      if (lead.score >= 75) return "High-priority -- initial knock, strong owner signal";
      return "Follow-up visit -- verify interest and schedule estimate";
  }
}

interface CanvassTarget {
  id: string;
  address: string;
  cityState: string;
  score: number;
  trade: string | null;
  permitValue: number | null;
  permitDescription: string | null;
  lastContacted: string;
  action: string;
}

function mapLeadToTarget(lead: Lead): CanvassTarget {
  return {
    id: lead.id,
    address: lead.address ?? "Unknown",
    cityState: [lead.city, lead.state].filter(Boolean).join(", "),
    score: lead.score,
    trade: lead.trade ?? null,
    permitValue: lead.permit_value ?? null,
    permitDescription: lead.permit_description ?? null,
    lastContacted: lead.contacted_at
      ? new Date(lead.contacted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "Never",
    action: getTradeAction(lead),
  };
}

export default function CanvassPage() {
  if (!STUBS_ENABLED) {
    return (
      <ComingSoon
        feature="Canvass targeting"
        description="AI-optimized door-knock routes from your live leads. We're building the mobile check-in and route optimizer now — expected in the next release."
      />
    );
  }
  return <CanvassPageInner />;
}

function CanvassPageInner() {
  const { data: leads, isLoading, error: leadsError, refetch } = useLeads({ filters: { status: ["new", "contacted"] } });

  const targets = useMemo(() => {
    if (!leads) return [];
    return [...leads]
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(mapLeadToTarget);
  }, [leads]);

  function generateRoute() {
    if (targets.length === 0) return;
    // Google's Maps URL API requires `destination`; a waypoints-only URL
    // renders an empty directions pane. Use the last stop as the
    // destination and everything before it as waypoints.
    const stops = targets.slice(0, 9).map((t) => t.address);
    const destination = encodeURIComponent(stops[stops.length - 1]);
    const waypoints = stops
      .slice(0, -1)
      .map((a) => encodeURIComponent(a))
      .join("|");
    const url =
      `https://www.google.com/maps/dir/?api=1&destination=${destination}` +
      (waypoints ? `&waypoints=${waypoints}` : "");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const stats = [
    { label: "Target Homes", value: targets.length },
    { label: "High Priority", value: targets.filter((t) => t.score >= 75).length },
    { label: "Never Contacted", value: targets.filter((t) => t.lastContacted === "Never").length },
    { label: "Followed Up", value: targets.filter((t) => t.lastContacted !== "Never").length },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-normal text-foreground">Canvass Targeting</h1>
        <p className="text-sm text-muted-foreground mt-1">AI-optimized door-knock routes from your live leads</p>
      </div>

      {/* Stats Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-12" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-heading font-normal text-foreground mt-1">{stat.value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Target List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-heading font-normal text-foreground">Target List</h2>
          <button
            type="button"
            onClick={generateRoute}
            disabled={targets.length === 0}
            title={targets.length === 0 ? "No targets to route yet" : "Opens a Google Maps route for the top stops"}
            className="flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <MapPin className="h-3.5 w-3.5" />
            Generate Route
          </button>
        </div>

        {isLoading ? (
          <Card className="overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-border flex gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </Card>
        ) : leadsError ? (
          /* A fetch failure must not read as "no targets in your area". */
          <Card role="alert" className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load your canvass targets &mdash; check your connection and retry.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              Retry
            </button>
          </Card>
        ) : targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-xl text-center">
            <p className="text-sm font-semibold text-foreground">No canvass targets yet</p>
            <p className="text-xs text-muted-foreground mt-1">Leads in your territory will appear here.</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Address</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Trade</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Permit Value</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Score</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Last Contacted</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Priority</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="text-foreground">{row.address}</div>
                      {row.cityState && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{row.cityState}</div>
                      )}
                      {row.permitDescription && (
                        <div className="text-[11px] text-fg-subtle mt-0.5 line-clamp-1 max-w-[240px]" title={row.permitDescription}>
                          {row.permitDescription}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{tradeBadge(row.trade)}</td>
                    <td className="px-4 py-3 text-foreground text-xs font-medium">
                      {row.permitValue != null ? formatCurrency(row.permitValue) : "--"}
                    </td>
                    <td className="px-4 py-3">{scoreBadge(row.score)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.lastContacted}</td>
                    <td className="px-4 py-3">{priorityBadge(row.score)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-[220px]">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
