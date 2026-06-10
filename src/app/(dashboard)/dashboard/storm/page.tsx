"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Zap, AlertTriangle } from "lucide-react";
import { useStorm } from "@/hooks/useStorm";
import { useLeads } from "@/hooks/useLeads";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpandableBanner } from "@/components/ui/expandable-banner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StageHistogram } from "@/components/analytics/StageHistogram";

/* ─── Helpers ─── */
function mapNwsSeverity(severity: string): "Severe" | "Moderate" | "Minor" {
  if (severity === "Extreme" || severity === "Severe") return "Severe";
  if (severity === "Moderate") return "Moderate";
  return "Minor";
}

function formatOnset(onset: string): string {
  try {
    return new Date(onset).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return onset;
  }
}

/* ─── Outreach Templates ─── */
const outreachTemplates = [
  {
    name: "Post-Storm SMS",
    channel: "SMS",
    template: `Hi [Name], this is [Company] — we noticed recent storm activity in your area (ZIP [ZIP]). We're offering free roof/property inspections for affected homeowners. Would you like to schedule one? Reply YES or call us at [Phone].`,
  },
  {
    name: "Insurance Claim Assist",
    channel: "Email",
    template: `Subject: Free Storm Damage Assessment — [ZIP] Area\n\nHi [Name],\n\nWith the recent [Storm Type] event in your area, many homeowners are discovering damage they didn't notice at first. We're offering complimentary inspections and can help document damage for your insurance claim.\n\nOur team has processed over 200 storm-related repairs this year and works directly with all major insurance carriers.\n\nWould you like to schedule a free assessment?\n\nBest,\n[Company]`,
  },
  {
    name: "Neighbor Blast",
    channel: "SMS",
    template: `Hi neighbor! We just completed storm damage repairs at [Address] near you. Many homes in [ZIP] were affected by the recent [Storm Type]. We're offering 15% off inspections for nearby homeowners this month. Reply YES for a free estimate.`,
  },
  {
    name: "Follow-Up (No Response)",
    channel: "SMS",
    template: `Hi [Name], just checking in — we reached out after the recent storm in [ZIP]. Storm damage can worsen quickly if left unaddressed. We still have openings for free inspections this week. Interested?`,
  },
];

/* ─── Components ─── */
function severityBadge(severity: string) {
  const map: Record<string, string> = {
    Severe: "bg-red-500/10 text-red-400",
    Moderate: "bg-yellow-500/10 text-yellow-400",
    Minor: "bg-blue-500/10 text-blue-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[severity] ?? "bg-zinc-500/10 text-muted-foreground"}`}>
      {severity}
    </span>
  );
}

function stormIcon(type: string) {
  if (type === "Hail")
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="3" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />
          <path d="M6.34 6.34a8 8 0 0 1 11.32 0" />
        </svg>
      </div>
    );
  if (type === "Flooding")
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M3 17c1.5-1 3-1.5 4.5 0s3 1 4.5 0 3-1.5 4.5 0 3 1 4.5 0" strokeLinecap="round" />
          <path d="M3 13c1.5-1 3-1.5 4.5 0s3 1 4.5 0 3-1.5 4.5 0 3 1 4.5 0" strokeLinecap="round" />
        </svg>
      </div>
    );
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/10 text-orange-400">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
      </svg>
    </div>
  );
}

function TemplateCard({ tpl }: { tpl: typeof outreachTemplates[0] }) {
  const [copied, setCopied] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{tpl.name}</h3>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            tpl.channel === "SMS" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
          }`}>
            {tpl.channel}
          </span>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(tpl.template); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="rounded-md bg-bg-subtle p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line max-h-28 overflow-y-auto">
        {tpl.template}
      </div>
    </Card>
  );
}

/* ─── Page ─── */
export default function StormPage() {
  // Persisted via localStorage so the toggle survives page reloads.
  // Long-term this should promote to profiles.storm_mode_enabled and
  // drive the scorer's demand-score multiplier — schema change deferred
  // to a future migration; localStorage covers the single-contractor case.
  const STORM_KEY = "henri.storm_mode.v1";
  const [stormMode, setStormMode] = useState(false);
  useEffect(() => {
    // Mount-once hydration from localStorage; cannot derive at render (SSR mismatch)
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORM_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "1") setStormMode(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORM_KEY, stormMode ? "1" : "0");
  }, [stormMode]);

  const { alerts, territories, isLoading } = useStorm();

  // Phase AA — pull the contractor's leads so we can break them down by
  // stage on the storm page. Restoration trades benefit from seeing
  // "how many of my permit-stage leads are filed-with-no-contractor"
  // alongside the active weather alerts. `isLoading` from useStorm is
  // independent of `useLeads` — render the histogram with its own
  // loading state.
  const { data: leadsForStage, isLoading: leadsLoading, error: leadsError, refetch: refetchLeads } = useLeads();

  // Restoration-trade subset — the stages that matter most for
  // storm-driven outreach (permit stages where the homeowner is still
  // hiring + maintenance windows on completed projects). Pure
  // in-memory filter; the histogram component already counts/sorts.
  const restorationLeads = useMemo(() => {
    return (leadsForStage ?? []).filter((l) => {
      const t = (l.trade ?? "").toLowerCase();
      return t.includes("roof") || t.includes("siding") || t.includes("exterior") || t.includes("gutter") || t === "roofing";
    });
  }, [leadsForStage]);

  const mappedAlerts = alerts.map((alert) => ({
    id: alert.id,
    type: alert.event,
    date: formatOnset(alert.onset),
    affectedZips: territories,
    severity: mapNwsSeverity(alert.severity),
    headline: alert.headline,
  }));

  const severeCount = alerts.filter(
    (a) => a.severity === "Extreme" || a.severity === "Severe"
  ).length;

  const mostSevereAlert = alerts.reduce<typeof alerts[number] | null>((worst, a) => {
    const rank: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
    if (!worst) return a;
    return (rank[a.severity] ?? 0) > (rank[worst.severity] ?? 0) ? a : worst;
  }, null);

  const quickStats = [
    { label: "Active Alerts", value: String(alerts.length) },
    { label: "Territories Monitored", value: String(territories.length) },
    { label: "Severe Alerts", value: String(severeCount) },
    {
      label: "Your ZIPs",
      value: territories.length > 3
        ? territories.slice(0, 3).join(", ") + "..."
        : territories.join(", ") || "None",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-normal text-foreground">Storm Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Weather events, damage leads, and rapid-response outreach</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Storm Mode Toggle */}
          <button
            onClick={() => setStormMode(!stormMode)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
              stormMode
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className={`h-4 w-4 ${stormMode ? "text-red-400" : ""}`} />
            Storm Mode {stormMode ? "ON" : "OFF"}
          </button>
          {isLoading ? (
            <span className="shrink-0 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              Loading...
            </span>
          ) : alerts.length > 0 ? (
            <span className="shrink-0 inline-flex items-center rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
              Live NWS Data
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              No alerts
            </span>
          )}
        </div>
      </div>

      {/* Storm Mode Banner — expandable to show activation details */}
      {stormMode && (
        <ExpandableBanner
          tone="storm"
          icon={<Zap className="h-4 w-4" />}
          title={<span className="font-medium">Storm Mode Active</span>}
          className="rounded-lg border"
        >
          <p className="mt-2">
            Storm Mode surfaces rapid-response outreach templates and
            active NWS alerts across your territories. Lead scoring and
            sending throughput are not currently adjusted by this flag —
            that integration is in progress.
          </p>
          <p className="mt-1 opacity-80">
            Toggle off when the rush subsides. The setting is saved in
            your browser, not on your account yet.
          </p>
        </ExpandableBanner>
      )}

      {/* Active Weather Alert Banner — expandable for full headline/instruction */}
      {mostSevereAlert && (
        <ExpandableBanner
          tone={
            mapNwsSeverity(mostSevereAlert.severity) === "Severe"
              ? "error"
              : mapNwsSeverity(mostSevereAlert.severity) === "Moderate"
              ? "warning"
              : "info"
          }
          icon={<AlertTriangle className="h-4 w-4" />}
          title={
            <span>
              <span className="font-medium">{mostSevereAlert.event}</span>
              {mostSevereAlert.headline ? ` — ${mostSevereAlert.headline}` : ""}
            </span>
          }
          defaultExpanded={mapNwsSeverity(mostSevereAlert.severity) === "Severe"}
          className="rounded-lg border"
        >
          {mostSevereAlert.description && (
            <p className="mt-2 whitespace-pre-line">{mostSevereAlert.description}</p>
          )}
          {mostSevereAlert.instruction && (
            <p className="mt-2 font-medium whitespace-pre-line">{mostSevereAlert.instruction}</p>
          )}
          {mostSevereAlert.areas && (
            <p className="mt-2 opacity-80">
              <span className="font-medium">Affected areas:</span> {mostSevereAlert.areas}
            </p>
          )}
          {mostSevereAlert.expires && (
            <p className="mt-1 opacity-80">
              <span className="font-medium">Expires:</span> {formatOnset(mostSevereAlert.expires)}
            </p>
          )}
        </ExpandableBanner>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </Card>
            ))
          : quickStats.map((stat) => (
              <Card key={stat.label} className="p-4">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-heading font-normal text-foreground mt-1">{stat.value}</p>
              </Card>
            ))}
      </div>

      {/* Active Events + Outreach Templates side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Events */}
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Active Events</h2>
          <div className="space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-full" />
                  </div>
                </Card>
              ))
            ) : mappedAlerts.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">No active weather alerts for your territories.</p>
              </Card>
            ) : (
              mappedAlerts.map((event) => (
                <Card key={event.id} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {stormIcon(event.type)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{event.type}</p>
                        {severityBadge(event.severity)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{event.date}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Affected ZIPs</span>
                      <span className="text-foreground">{event.affectedZips.join(", ")}</span>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* Outreach Templates */}
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground mb-3">Outreach Templates</h2>
          <div className="space-y-3">
            {outreachTemplates.map((tpl, i) => (
              <TemplateCard key={i} tpl={tpl} />
            ))}
          </div>
        </div>
      </div>

      {/* Phase AA — Stage breakdown for restoration-trade leads. Lets the
          contractor see where their roofing / exterior / siding pipeline
          actually sits (permit-filed-no-contractor vs. project-moving vs.
          maintenance) alongside the current storm alerts. Falls back to
          all leads if the restoration filter returns empty (e.g. for a
          GC who handles everything). */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">
          {restorationLeads.length > 0 ? "Restoration-trade pipeline by stage" : "Pipeline by stage"}
        </h2>
        {leadsError ? (
          /* Fetch failed — alert-with-retry INSTEAD of an empty histogram,
           * so a DB hiccup doesn't read as "no pipeline". */
          <Card role="alert" className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load your pipeline &mdash; check your connection and retry.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetchLeads()}>
              Retry
            </Button>
          </Card>
        ) : (
          <StageHistogram
            leads={restorationLeads.length > 0 ? restorationLeads : leadsForStage}
            isLoading={leadsLoading}
          />
        )}
      </div>

      {/* Historical Timeline */}
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground mb-3">Storm History & Permit Surge</h2>
        <Card className="p-5">
          <div className="space-y-4">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <Skeleton className="h-3 w-3 rounded-full shrink-0 mt-1" />
                    {i < 2 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="pb-3 flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                </div>
              ))
            ) : mappedAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No storm history to display.</p>
            ) : (
              mappedAlerts.map((event, i) => (
                <div key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`h-3 w-3 rounded-full shrink-0 mt-1 ${
                      event.severity === "Severe" ? "bg-red-500" :
                      event.severity === "Moderate" ? "bg-yellow-500" : "bg-blue-500"
                    }`} />
                    {i < mappedAlerts.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="pb-3 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-foreground font-medium">{event.type} — {event.date}</p>
                      {severityBadge(event.severity)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {event.affectedZips.length} ZIPs affected
                    </p>
                    <div className="mt-2 flex items-center gap-4">
                      <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${event.severity === "Severe" ? 85 : event.severity === "Moderate" ? 50 : 25}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {event.severity}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
