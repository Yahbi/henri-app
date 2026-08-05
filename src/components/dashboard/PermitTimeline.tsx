"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  ClipboardList,
  CheckCircle2,
  SearchCheck,
  Flag,
  XCircle,
  Hourglass,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { logger } from "@/lib/logger";

/**
 * Phase 0b wedge #5 — project-stage timeline.
 *
 * "A permit tells you a project exists — not who's still buying."
 * This component surfaces the project stage by rendering the
 * lifecycle as a timeline: planning → applied → issued →
 * rough-inspection → final-inspection → CO-issued. Each milestone is
 * fetched from the `permit_events` table (migration 00031). When no
 * events exist yet, we synthesize the baseline from `permits.status`
 * so the timeline still shows something useful.
 */

type EventType =
  | "planning"
  | "applied"
  | "issued"
  | "rough_inspection"
  | "final_inspection"
  | "co_issued"
  | "expired"
  | "revoked";

interface PermitEvent {
  id?: string;
  event_type: EventType;
  occurred_at: string;
  source?: string | null;
  notes?: string | null;
}

const STAGE_ORDER: EventType[] = [
  "planning",
  "applied",
  "issued",
  "rough_inspection",
  "final_inspection",
  "co_issued",
];

const STAGE_META: Record<
  EventType,
  { label: string; icon: typeof FileText; tone: "cool" | "primary" | "success" | "hot" }
> = {
  planning:         { label: "Planning / zoning",       icon: ClipboardList, tone: "cool" },
  applied:          { label: "Permit applied",          icon: FileText,       tone: "cool" },
  issued:           { label: "Permit issued",           icon: CheckCircle2,   tone: "primary" },
  rough_inspection: { label: "Rough-in inspection",     icon: SearchCheck,    tone: "primary" },
  final_inspection: { label: "Final inspection",        icon: SearchCheck,    tone: "success" },
  co_issued:        { label: "Certificate of occupancy", icon: Flag,          tone: "success" },
  expired:          { label: "Expired",                 icon: Hourglass,      tone: "hot" },
  revoked:          { label: "Revoked",                 icon: XCircle,        tone: "hot" },
};

function toneClasses(tone: "cool" | "primary" | "success" | "hot") {
  switch (tone) {
    case "cool":
      return "bg-bg-subtle text-muted-foreground border-border";
    case "primary":
      return "bg-primary-10 text-primary border-primary/30";
    case "success":
      return "bg-[color-mix(in_srgb,hsl(var(--success))_10%,transparent)] text-success border-success/30";
    case "hot":
      return "bg-[color-mix(in_srgb,var(--hot)_8%,transparent)] text-hot border-hot/30";
  }
}

/**
 * Synthesize baseline events from `permits.status` + dates. Used when
 * the `permit_events` table is empty for a given permit (migration
 * 00031 not applied yet, or the scraper hasn't written historical
 * events).
 */
function synthesizeFromPermitStatus(permit: {
  applied_date?: string | null;
  issued_date?: string | null;
  status?: string | null;
  completed_date?: string | null;
}): PermitEvent[] {
  const out: PermitEvent[] = [];
  if (permit.applied_date) {
    out.push({ event_type: "applied", occurred_at: permit.applied_date, source: "synthesized:permits.applied_date" });
  }
  if (permit.issued_date) {
    out.push({ event_type: "issued", occurred_at: permit.issued_date, source: "synthesized:permits.issued_date" });
  }
  if (permit.completed_date) {
    out.push({ event_type: "co_issued", occurred_at: permit.completed_date, source: "synthesized:permits.completed_date" });
  }
  const status = (permit.status ?? "").toLowerCase();
  if (status === "expired") {
    out.push({ event_type: "expired", occurred_at: permit.completed_date ?? permit.issued_date ?? new Date().toISOString(), source: "synthesized:permits.status" });
  }
  if (status === "revoked") {
    out.push({ event_type: "revoked", occurred_at: new Date().toISOString(), source: "synthesized:permits.status" });
  }
  return out;
}

export function PermitTimeline({
  permitId,
  permit,
}: {
  permitId: string | null | undefined;
  permit: {
    applied_date?: string | null;
    issued_date?: string | null;
    status?: string | null;
    completed_date?: string | null;
  };
}) {
  const [events, setEvents] = useState<PermitEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingSynthesized, setUsingSynthesized] = useState(false);
  // A failed fetch fell into the same synthesized-from-dates path as "no
  // events recorded", so an outage was labelled with the neutral
  // "(derived from permit dates)" footnote and looked identical to
  // healthy behaviour.
  const [fetchFailed, setFetchFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!permitId) {
      // No DB id — fall back to synthesized events from the permit dates.
      setEvents(synthesizeFromPermitStatus(permit));
      setUsingSynthesized(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchFailed(false);
      try {
        const res = await fetch(`/api/permit-events?permit_id=${permitId}`);
        if (!res.ok) {
          if (!cancelled) {
            setEvents(synthesizeFromPermitStatus(permit));
            setUsingSynthesized(true);
            setFetchFailed(true);
          }
          return;
        }
        const body = (await res.json()) as { events: PermitEvent[]; migrationPending?: boolean };
        if (!cancelled) {
          if (body.events && body.events.length > 0) {
            setEvents(body.events);
            setUsingSynthesized(false);
          } else {
            setEvents(synthesizeFromPermitStatus(permit));
            setUsingSynthesized(true);
          }
        }
      } catch (e) {
        if (!cancelled) {
          logger.warn("PermitTimeline: permit-events fetch failed", {
            permitId,
            error: e instanceof Error ? e.message : String(e),
          });
          setEvents(synthesizeFromPermitStatus(permit));
          setUsingSynthesized(true);
          setFetchFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `permit` as an object-prop gets a new identity every render in
    // callers that inline the object literal (see LeadDetailDrawer).
    // The fields we actually read from it are listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permitId, retryNonce, permit.applied_date, permit.issued_date, permit.completed_date, permit.status]);

  // Always render the timeline scaffold when we have a permit backing
  // the lead, even without any dated events yet. The dashed-outline
  // pills give contractors an at-a-glance feel for "where this project
  // is in its lifecycle." Returning null when dates are missing was
  // the prior behavior; it silently hid the whole feature on every
  // legacy-import permit with null applied_date.
  if (!permitId && events.length === 0 && !loading) return null;

  // Map event types we've seen → most-recent timestamp
  const seen = new Map<EventType, string>();
  for (const e of events) {
    const prev = seen.get(e.event_type);
    if (!prev || new Date(e.occurred_at).getTime() > new Date(prev).getTime()) {
      seen.set(e.event_type, e.occurred_at);
    }
  }

  const hasTerminal = seen.has("expired") || seen.has("revoked");

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <ClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Project stage
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {usingSynthesized && !fetchFailed && (
          <span className="text-[9.5px] text-muted-foreground italic">
            (derived from permit dates)
          </span>
        )}
        {fetchFailed && (
          <span role="alert" className="flex items-center gap-1 text-[9.5px] text-destructive">
            Timeline couldn&apos;t load — showing permit dates only.
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              Retry
            </button>
          </span>
        )}
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {STAGE_ORDER.map((stage) => {
          const when = seen.get(stage);
          const done = !!when;
          const meta = STAGE_META[stage];
          const Icon = meta.icon;
          return (
            <li
              key={stage}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px]",
                done ? toneClasses(meta.tone) : "bg-transparent text-muted-foreground/60 border-dashed border-border/60",
              )}
              title={when ? `${meta.label} — ${new Date(when).toLocaleDateString()}` : `${meta.label} — pending`}
            >
              <Icon className="h-2.5 w-2.5 shrink-0" />
              <span className="capitalize">{meta.label.split(" / ")[0].split(" ")[0]}</span>
              {when && (
                <span className="text-[9px] opacity-80">
                  · {new Date(when).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </li>
          );
        })}
        {hasTerminal && (
          <li
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px]",
              toneClasses("hot"),
            )}
          >
            {seen.has("expired") ? "Expired" : "Revoked"}
          </li>
        )}
      </ol>
    </div>
  );
}
