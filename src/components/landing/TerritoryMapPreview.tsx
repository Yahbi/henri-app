"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, ShieldCheck, Hash, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { UsState } from "@/lib/stats/us-states";

/*
 * Landing-page coverage section.
 *
 * HISTORY
 * v1 dropped the full contractor MapDashboard onto the marketing page,
 * which read as an unfinished admin tool. v2 replaced it with a
 * hand-arranged grid of 20 Los Angeles ZIP tiles labelled "Active" and
 * "Coming" — fast and pretty, but the ZIPs were invented and the
 * Active/Coming split was decorative, so the section carried a caveat
 * admitting the tiles were illustrative. A visitor asking "do you cover
 * my area?" got a decoration.
 *
 * v3 (2026-08-04) shows the real distribution: the top states by permit
 * volume with their exact counts, sourced from the `landing_stats`
 * cache (migration 00115). The bars are proportional to real numbers
 * and every figure is a stored count, so the caveat is gone because the
 * thing it was apologising for is gone.
 *
 * Why a cache: the underlying `GROUP BY state` is a 37s parallel
 * sequential scan against PostgREST's 8s statement_timeout — measured,
 * not estimated. It cannot be served from a request path, which is why
 * this section shipped with invented tiles for three months.
 *
 * Graceful degrade: with no histogram (cache row missing, or a build
 * without Supabase secrets) the ranked list is omitted entirely and the
 * section falls back to the stat cards. It never renders zeros or
 * placeholder rows.
 *
 * Truthfulness: no number here is authored. Counts come from the
 * database; labels are rounded DOWN per CLAUDE.md.
 */

interface TerritoryMapPreviewProps {
  permitsLabel: string;
  activeStatesLabel: string;
  /** Live per-state permit counts, keyed by 2-letter code. */
  statePermits?: Readonly<Partial<Record<UsState, number>>>;
  /** "18,000+" — empty/absent when the coverage cache is unavailable. */
  zipsCoveredLabel?: string;
}

/** How many states to rank. Enough to show real breadth, few enough to scan. */
const TOP_N = 12;

const nf = new Intl.NumberFormat("en-US");

export function TerritoryMapPreview({
  permitsLabel,
  activeStatesLabel,
  statePermits,
  zipsCoveredLabel,
}: TerritoryMapPreviewProps) {
  const ranked = useMemo(() => {
    const entries = Object.entries(statePermits ?? {}) as [UsState, number][];
    const sorted = entries
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N);
    // Bars are scaled against the leader, not against the total, so the
    // long tail stays visible instead of collapsing to a hairline.
    const max = sorted[0]?.[1] ?? 0;
    return sorted.map(([state, count]) => ({
      state,
      count,
      pct: max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0,
    }));
  }, [statePermits]);

  // Deliberately NOT the same population as the "States covered" stat
  // card below, and the two are expected to disagree on screen.
  //
  // `statePermits` is every state holding at least one permit (46 on
  // 2026-08-05). `activeStatesLabel` counts only states we are willing to
  // call covered, which since 2026-08-05 means states holding enough
  // ZIP-BEARING permits to sell — territories are sold per ZIP and 63.9%
  // of the catalog carries none. The copy below is worded "with permits
  // in the catalog" precisely because it is the wider, weaker claim; do
  // not "reconcile" the two numbers by swapping one for the other.
  const totalStates = Object.keys(statePermits ?? {}).length;
  const remaining = Math.max(0, totalStates - ranked.length);

  const STATS = [
    { icon: MapPin, value: permitsLabel, label: "Permits tracked" },
    { icon: ShieldCheck, value: activeStatesLabel, label: "States covered" },
    ...(zipsCoveredLabel
      ? [{ icon: Hash, value: zipsCoveredLabel, label: "ZIP codes with permits" }]
      : []),
    { icon: Clock, value: "Daily", label: "Catalog refresh" },
  ];

  /* Progressive reveal — rows fade in sequentially on scroll into view.
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
            {ranked.length > 0
              ? "Every number below is a live count from Henri's permit catalog, updated daily as new jurisdictions come online."
              : "Henri's permit catalog is live in major US metro areas today and onboarding new jurisdictions weekly."}
          </p>
        </div>

        {ranked.length > 0 && (
          <Card
            variant="elevated"
            className="mt-12 overflow-hidden border-border bg-gradient-to-br from-background to-bg-subtle"
          >
            <CardContent className="p-8 sm:p-12">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Permits by state — top {ranked.length}
              </h3>

              <ol className="mt-6 space-y-3">
                {ranked.map((row, idx) => (
                  <li
                    key={row.state}
                    className={`flex items-center gap-4 transition-all duration-500 ${
                      visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                    }`}
                    style={{ transitionDelay: visible ? `${idx * 40}ms` : "0ms" }}
                  >
                    <span className="w-8 shrink-0 font-mono text-sm font-medium text-foreground">
                      {row.state}
                    </span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/5">
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                        style={{ width: visible ? `${row.pct}%` : "0%" }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                      {nf.format(row.count)}
                    </span>
                  </li>
                ))}
              </ol>

              {remaining > 0 && (
                <p className="mt-6 text-sm text-muted-foreground">
                  Plus {remaining} more states with permits in the catalog.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stat cards — honest numbers only, per CLAUDE.md. */}
        <div
          className={`mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 ${
            STATS.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
          }`}
        >
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
