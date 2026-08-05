"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { TrendingUp } from "lucide-react";
import { useBenchmarks, type Benchmark } from "@/hooks/useBenchmarks";

/* ─── Fallback Renovation ROI data (based on 2025-2026 Cost vs Value Report) ─── */
const fallbackRenovationROI = [
  { project: "Garage Door Replacement", cost: 4400, valueAdded: 8520, roi: 194 },
  { project: "Manufactured Stone Veneer", cost: 11300, valueAdded: 17300, roi: 153 },
  { project: "Minor Kitchen Remodel", cost: 28000, valueAdded: 26800, roi: 96 },
  { project: "Siding Replacement (Fiber Cement)", cost: 22000, valueAdded: 20400, roi: 93 },
  { project: "Window Replacement (Vinyl)", cost: 22200, valueAdded: 19200, roi: 86 },
  { project: "Bath Remodel (Midrange)", cost: 25500, valueAdded: 19600, roi: 77 },
  { project: "Roof Replacement (Asphalt)", cost: 32000, valueAdded: 23000, roi: 72 },
  { project: "Major Kitchen Remodel", cost: 82000, valueAdded: 52400, roi: 64 },
  { project: "Primary Suite Addition", cost: 175000, valueAdded: 98400, roi: 56 },
  { project: "Deck Addition (Wood)", cost: 21000, valueAdded: 11400, roi: 54 },
];

/* ─── Estimated ROI percentages by trade ─── */
const ROI_BY_TRADE: Record<string, number> = {
  kitchen: 75,
  bathroom: 70,
  roof: 60,
  hvac: 50,
  windows: 65,
  solar: 80,
  adu: 70,
  electrical: 40,
  plumbing: 35,
  painting: 55,
  landscaping: 50,
  foundation: 30,
};

/** Look up estimated ROI for a benchmark based on its trade (case-insensitive partial match). */
function estimateROI(trade: string): number {
  const lower = trade.toLowerCase();
  for (const [key, roi] of Object.entries(ROI_BY_TRADE)) {
    if (lower.includes(key)) return roi;
  }
  return 50; // default estimate when trade doesn't match
}

/** Map a Benchmark to the same shape as the fallback renovation ROI entries. */
function benchmarkToROI(b: Benchmark) {
  const roi = estimateROI(b.trade);
  const cost = Math.round(b.cost_avg);
  const valueAdded = Math.round(cost * (roi / 100));
  return {
    project: b.project_type || b.trade,
    cost,
    valueAdded,
    roi,
  };
}

interface PropertyTrackerProps {
  homeValue?: number;
  mortgage?: number;
  zip?: string;
}

export function PropertyTracker({ homeValue: initialValue, mortgage: initialMortgage, zip = "" }: PropertyTrackerProps) {
  // Persistence wired to /api/homeowner/property — Phase 1.6. Homeowners now
  // see a "Set up your home profile" card on first load rather than the old
  // hard-coded $580k demo values.
  const [homeValue, setHomeValue] = useState<number>(initialValue ?? 0);
  const [mortgage, setMortgage] = useState<number>(initialMortgage ?? 0);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // The PATCH result was discarded entirely — a failed save looked
  // identical to a successful one until the values vanished on reload.
  const [saveError, setSaveError] = useState<string | null>(null);

  // On mount, fetch any stored values. If the homeowner has no row yet,
  // leave zeros in state and show the setup card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/homeowner/property");
        if (!res.ok) return;
        const body = (await res.json()) as {
          property: { home_value: number | null; mortgage: number | null } | null;
        };
        if (cancelled) return;
        if (body.property) {
          setHomeValue(body.property.home_value ?? 0);
          setMortgage(body.property.mortgage ?? 0);
        }
      } catch {
        /* ignore — empty state is fine */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // PATCH on save — called when user clicks "Done" after editing.
  const persist = useCallback(async (nextValue: number, nextMortgage: number) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/homeowner/property", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home_value: nextValue,
          mortgage: nextMortgage,
          zip: zip || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(body?.error ?? `Couldn't save your values (HTTP ${res.status}).`);
        return false;
      }
      return true;
    } catch {
      setSaveError("Couldn't reach the server — your values weren't saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [zip]);

  /* Fetch real benchmark data for the user's ZIP */
  const { benchmarks } = useBenchmarks(zip);

  /* Map benchmarks to renovation ROI format, falling back to hardcoded data */
  const renovationROI = useMemo(() => {
    if (benchmarks.length === 0) return fallbackRenovationROI;
    return benchmarks
      .map(benchmarkToROI)
      .sort((a, b) => b.roi - a.roi);
  }, [benchmarks]);

  const equity = homeValue - mortgage;
  // Clamp: an underwater mortgage produced a negative percentage, which
  // rendered as a negative CSS width and a >100% "Mortgage" label.
  const equityPct =
    homeValue > 0
      ? Math.max(0, Math.min(100, Math.round((equity / homeValue) * 100)))
      : 0;
  const ltv = homeValue > 0 ? Math.round((mortgage / homeValue) * 100) : 0;

  // First-time empty state — no stored values yet. Prompt to set up.
  const isUnset = loaded && homeValue === 0 && mortgage === 0 && !editing;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-heading font-normal text-foreground">Property Value Tracker</h2>
          <p className="text-xs text-muted-foreground mt-1">Track your equity and find high-ROI renovations</p>
        </div>
        <button
          onClick={async () => {
            if (editing) {
              // Stay in edit mode when the save failed so the values the
              // user typed are still on screen to retry with.
              const ok = await persist(homeValue, mortgage);
              if (!ok) return;
              setEditing(false);
              return;
            }
            setSaveError(null);
            setEditing(true);
          }}
          disabled={saving || !loaded}
          className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
        >
          {saving ? "Saving…" : editing ? "Done" : isUnset ? "Set up" : "Edit Values"}
        </button>
      </div>

      {saveError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </p>
      )}

      {/* Empty state — no stored values yet. Phase 1.6 — replaces the
          old hard-coded $580k demo values with an honest setup prompt. */}
      {isUnset && (
        <div className="rounded-lg border border-dashed border-border bg-bg-subtle p-4 text-center">
          <p className="text-sm font-medium text-foreground">
            Set up your home profile
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your home value and mortgage balance so we can show your real
            equity and suggest renovations with the best ROI.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="mt-3 inline-block rounded-lg bg-cta px-4 py-2 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90"
          >
            Add your values →
          </button>
        </div>
      )}

      {/* Value inputs (when editing) */}
      {editing && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="pt-home-value" className="text-xs font-medium text-muted-foreground block mb-1">Home Value ($)</label>
            <input
              id="pt-home-value"
              type="number"
              min={0}
              value={homeValue}
              onChange={(e) => setHomeValue(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="pt-mortgage" className="text-xs font-medium text-muted-foreground block mb-1">Mortgage Balance ($)</label>
            <input
              id="pt-mortgage"
              type="number"
              min={0}
              value={mortgage}
              onChange={(e) => setMortgage(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Equity Display */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-bg-subtle p-4 text-center">
          <p className="text-xs text-muted-foreground">Home Value</p>
          <p className="text-xl font-heading font-normal text-foreground mt-1">${(homeValue / 1000).toFixed(0)}K</p>
        </div>
        <div className="rounded-lg bg-primary/5 p-4 text-center">
          <p className="text-xs text-primary font-medium">Your Equity</p>
          <p className="text-xl font-heading font-normal text-primary mt-1">${(equity / 1000).toFixed(0)}K</p>
          <p className="text-[10px] text-muted-foreground">{equityPct}% equity</p>
        </div>
        <div className="rounded-lg bg-bg-subtle p-4 text-center">
          <p className="text-xs text-muted-foreground">Mortgage</p>
          <p className="text-xl font-heading font-normal text-foreground mt-1">${(mortgage / 1000).toFixed(0)}K</p>
          <p className="text-[10px] text-muted-foreground">{ltv}% LTV</p>
        </div>
      </div>

      {/* Equity bar */}
      <div className="space-y-1">
        <div className="h-3 rounded-full bg-bg-subtle overflow-hidden flex">
          <div className="h-full bg-primary rounded-l-full transition-all" style={{ width: `${equityPct}%` }} />
          <div className="h-full bg-muted-foreground/20 rounded-r-full flex-1" />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Equity: {equityPct}%</span>
          <span>Mortgage: {100 - equityPct}%</span>
        </div>
      </div>

      {/* Renovation ROI Table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Highest-ROI Renovations</h3>
        </div>
        <div className="space-y-2">
          {renovationROI.slice(0, 5).map((r) => (
            <div key={r.project} className="flex items-center gap-3 rounded-lg bg-bg-subtle p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{r.project}</p>
                <p className="text-xs text-muted-foreground">Avg. cost: ${r.cost.toLocaleString()}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-primary">+${r.valueAdded.toLocaleString()}</p>
                <p className={`text-xs font-medium ${r.roi >= 90 ? "text-green-400" : r.roi >= 70 ? "text-yellow-400" : "text-muted-foreground"}`}>
                  {r.roi}% ROI
                </p>
              </div>
            </div>
          ))}
        </div>
        {/* Honesty: even on the benchmark path only the COST is local —
            the ROI percentage comes from the static ROI_BY_TRADE table
            above, so "+$X value added" is a national estimate either way.
            The old copy implied the whole row was locally derived. */}
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          {benchmarks.length > 0
            ? `Costs from local project data for ZIP ${zip}; resale-value percentages are national industry estimates, not appraisals.`
            : "National averages from published industry cost-vs-value data, not an appraisal. Actual ROI varies by location and project quality."}
        </p>
      </div>
    </div>
  );
}
