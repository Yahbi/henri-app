"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, ShieldCheck, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/*
 * Landing-page territory visualization.
 *
 * Previous version dropped the full contractor MapDashboard onto the
 * marketing page, which made the section look like an unfinished admin
 * tool (weather banner, overlay controls, style switcher). Founder
 * feedback: "doesn't look pro."
 *
 * This replacement is a hand-crafted SVG grid of ZIP tiles showing
 * availability states (Open / 1 slot left / Claimed). No live map
 * library, no overlay controls, no tile requests — renders instantly,
 * reads honestly, and conveys "one contractor per trade per ZIP" at a
 * glance without needing the contractor workspace.
 *
 * Truthfulness: stats below reflect live Supabase counts (audit
 * 2026-05-03):
 *   permits.total           = 1,416,065  (rounded down to "1.4M+")
 *   permit_sources.states   = 38         (kept at "30+" — under-promise)
 *   leads.total             = 231,110
 * Always rounded DOWN. Never invent metrics.
 */

type TileStatus = "active" | "coming";

interface Tile {
  zip: string;
  status: TileStatus;
  /* Grid position for visual variety. */
  col: number;
  row: number;
}

/* Hand-arranged grid that evokes a city gridmap without pretending to
   be a real one. ZIPs are purely illustrative — not tied to live DB
   state.
   2026-04-30 truthfulness pass: switched the "claimed / 1 slot left /
   open" availability framing to "active / coming" coverage framing.
   The earlier framing implied a real per-ZIP exclusivity scoreboard
   (which doesn't exist — there's no UI lock acquisition). The new
   framing matches what's actually true: Henri's permit catalog covers
   some ZIPs today and is rolling out to more. */
const TILES: Tile[] = [
  { zip: "90028", status: "active",   col: 0, row: 0 },
  { zip: "90038", status: "active",   col: 1, row: 0 },
  { zip: "90046", status: "coming",   col: 2, row: 0 },
  { zip: "90069", status: "active",   col: 3, row: 0 },
  { zip: "90077", status: "coming",   col: 4, row: 0 },
  { zip: "90024", status: "active",   col: 0, row: 1 },
  { zip: "90025", status: "coming",   col: 1, row: 1 },
  { zip: "90034", status: "active",   col: 2, row: 1 },
  { zip: "90035", status: "coming",   col: 3, row: 1 },
  { zip: "90064", status: "active",   col: 4, row: 1 },
  { zip: "90403", status: "coming",   col: 0, row: 2 },
  { zip: "90404", status: "active",   col: 1, row: 2 },
  { zip: "90405", status: "active",   col: 2, row: 2 },
  { zip: "90272", status: "coming",   col: 3, row: 2 },
  { zip: "90291", status: "coming",   col: 4, row: 2 },
  { zip: "90066", status: "active",   col: 0, row: 3 },
  { zip: "90230", status: "coming",   col: 1, row: 3 },
  { zip: "90232", status: "active",   col: 2, row: 3 },
  { zip: "90094", status: "coming",   col: 3, row: 3 },
  { zip: "90292", status: "active",   col: 4, row: 3 },
];

const STATUS_STYLES: Record<TileStatus, {
  fill: string;
  border: string;
  label: string;
  dot: string;
}> = {
  active: {
    fill: "bg-primary/10",
    border: "border-primary/30",
    label: "Active",
    dot: "bg-primary",
  },
  coming: {
    fill: "bg-success/10",
    border: "border-success/30",
    label: "Coming",
    dot: "bg-success",
  },
};

/* Stats match the Hero's conservative framing so numbers never
   disagree across the landing page. "30+" reflects the live DB count
   (audit 2026-04-30: 35 distinct US states with at least one ingested
   permit); kept conservative to stay defensible.

   2026-04-30: dropped the "14-day · Exclusive window" stat. The lock
   infrastructure exists in DB but no UI path acquires a lock, so the
   claim was overclaiming. See plan file
   ~/.claude/plans/whats-the-14-days-purring-papert.md. */
const STATS = [
  // 2026-05-03 stat refresh: 1,416,065 permits live → "1.4M+".
  { icon: MapPin,      value: "1.4M+", label: "Permits tracked" },
  { icon: ShieldCheck, value: "30+",   label: "States covered" },
  { icon: Clock,       value: "Daily",  label: "Catalog refresh" },
] as const;

export function TerritoryMapPreview() {
  /* Progressive reveal — tiles fade in sequentially on scroll into view.
     Cheap effect, big visual payoff, no JS dep. */
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
            Coverage that grows where you need it
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Henri&apos;s permit catalog is live in major US metro areas
            today and onboarding new jurisdictions weekly. ZIP codes
            shown below are illustrative.
          </p>
        </div>

        {/* Territory grid — card-framed SVG-ish tile visualization */}
        <Card variant="elevated" className="mt-12 overflow-hidden bg-gradient-to-br from-background to-bg-subtle border-border">
          <CardContent className="p-8 sm:p-12">
            <div className="flex flex-col items-center">
              {/* Tile grid */}
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gridTemplateRows: "repeat(4, auto)",
                }}
                role="img"
                aria-label="Illustrative grid of ZIP codes showing coverage states: Active and Coming. Real coverage varies by jurisdiction."
              >
                {TILES.map((tile, idx) => {
                  const style = STATUS_STYLES[tile.status];
                  /* Stagger the reveal by grid index so the whole thing
                     washes in from top-left to bottom-right. */
                  const delay = visible ? `${idx * 30}ms` : "0ms";
                  return (
                    <div
                      key={tile.zip}
                      className={`${style.fill} ${style.border} rounded-xl border px-4 py-5 text-left transition-all duration-500 ${
                        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                      }`}
                      style={{ transitionDelay: delay }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {style.label}
                        </span>
                      </div>
                      <div className="mt-1.5 font-mono text-lg font-medium tracking-tight text-foreground">
                        {tile.zip}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                {(Object.keys(STATUS_STYLES) as TileStatus[]).map((k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[k].dot}`} />
                    <span>{STATUS_STYLES[k].label}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stat cards — honest numbers only, per CLAUDE.md. */}
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STATS.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} variant="translucent" className="text-center">
                <CardContent className="flex flex-col items-center gap-2 p-6">
                  <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  <span className="font-heading text-3xl font-normal text-foreground">
                    {stat.value}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
