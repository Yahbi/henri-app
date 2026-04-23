"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PermitHistoryRow } from "@/hooks/usePermitHistory";

/**
 * Permit history — cleaner, de-duped, grouped by year.
 *
 * Replaces the old flat list that repeated the same permit_type label
 * on every row, treated each filing as a distinct event (so a single
 * project could show up 3-4 times for plan-review + issue + re-issue),
 * and buried the current permit inline instead of pinning it.
 *
 * Layout:
 *   1. Summary strip — N permits · $X total · first filed YYYY
 *   2. Live permit — card with description (if we're on a permit-backed lead)
 *   3. Prior work — grouped by year, exact dupes collapsed
 */

interface DedupedRow {
  representative: PermitHistoryRow;
  duplicates: number;           // 1 = unique, >1 = grouped
  latestDateISO: string | null; // for sort
  totalValue: number;           // summed across dupes
}

function permitDateISO(p: PermitHistoryRow): string | null {
  return p.issued_date ?? p.applied_date ?? p.completed_date ?? null;
}

function yearOf(iso: string | null): string {
  if (!iso) return "Undated";
  const y = iso.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : "Undated";
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
}

function scopeKey(p: PermitHistoryRow): string {
  // Collapse near-identical re-filings: same address + type +
  // first ~50 chars of scope + rounded value (to nearest $5K so
  // $50,000 vs $50,001 doesn't split). Case-insensitive.
  const type = (p.permit_type ?? "").toLowerCase();
  const desc = (p.description ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  const v = Number(p.estimated_value ?? 0);
  const vBucket = v > 0 ? Math.round(v / 5000) * 5000 : 0;
  return `${type}|${desc}|${vBucket}`;
}

function statusTone(status: string | null | undefined):
  | "success" | "primary" | "warm" | "muted" {
  const s = (status ?? "").toLowerCase();
  if (s === "final" || s === "co_issued" || s === "completed") return "success";
  if (s === "issued" || s === "approved") return "primary";
  if (s === "expired" || s === "revoked") return "muted";
  return "warm";
}

function toneClasses(tone: "success" | "primary" | "warm" | "muted"): string {
  switch (tone) {
    case "success": return "bg-success";
    case "primary": return "bg-primary";
    case "warm":    return "bg-warm";
    case "muted":   return "bg-muted-foreground";
  }
}

export function PermitHistorySection({
  history,
  currentPermitNumber,
  isLoading,
  expandedDescriptions = false,
}: {
  history: PermitHistoryRow[];
  currentPermitNumber?: string | null;
  isLoading: boolean;
  /** When true, inline descriptions render on prior-work rows
   *  (matches the drawer's expanded-height behavior). */
  expandedDescriptions?: boolean;
}) {
  const { livePermit, dedupedHistory, summary } = useMemo(() => {
    // Pin the live permit by matching jurisdiction permit number first.
    const live = currentPermitNumber
      ? history.find((p) => p.permit_number === currentPermitNumber) ?? null
      : null;
    const rest = live ? history.filter((p) => p !== live) : history.slice();

    // Dedupe prior work.
    const byKey = new Map<string, DedupedRow>();
    for (const p of rest) {
      const k = scopeKey(p);
      const dateISO = permitDateISO(p);
      const v = Number(p.estimated_value ?? 0);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { representative: p, duplicates: 1, latestDateISO: dateISO, totalValue: v });
      } else {
        existing.duplicates++;
        existing.totalValue += v;
        // Keep the row with the latest date as the representative so
        // the row's "issued_date" accurately reflects the most recent
        // filing for that scope.
        if (dateISO && (!existing.latestDateISO || dateISO > existing.latestDateISO)) {
          existing.latestDateISO = dateISO;
          existing.representative = p;
        }
      }
    }
    const deduped = [...byKey.values()].sort((a, b) => {
      const aT = a.latestDateISO ?? "";
      const bT = b.latestDateISO ?? "";
      return bT.localeCompare(aT); // newest first
    });

    // Summary rollup — uses the full (non-deduped) history so
    // "$3.4M total" reflects true dollar volume even though we
    // collapse visually.
    const allValues = history
      .map((p) => Number(p.estimated_value ?? 0))
      .filter((v) => v > 0);
    const totalValue = allValues.reduce((s, v) => s + v, 0);
    const dates = history.map((p) => permitDateISO(p)).filter((d): d is string => !!d).sort();
    const firstFiled = dates[0]?.slice(0, 4) ?? null;

    return {
      livePermit: live,
      dedupedHistory: deduped,
      summary: {
        count: history.length,
        uniqueProjects: deduped.length + (live ? 1 : 0),
        totalValue,
        firstFiled,
      },
    };
  }, [history, currentPermitNumber]);

  const [showAllPrior, setShowAllPrior] = useState(false);
  const VISIBLE_LIMIT = 3;

  if (history.length === 0 && !isLoading) return null;

  // Group by year for the "Prior work" section.
  const byYear = new Map<string, DedupedRow[]>();
  for (const row of dedupedHistory) {
    const y = yearOf(row.latestDateISO);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(row);
  }
  const years = [...byYear.keys()].sort((a, b) => {
    if (a === "Undated") return 1;
    if (b === "Undated") return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="border-t border-border pt-2.5 space-y-3">
      {/* Summary header */}
      <div className="flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Property permit history
        </span>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {history.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <SummaryStat
            value={summary.count.toLocaleString()}
            label="filings"
          />
          {summary.uniqueProjects !== summary.count && (
            <SummaryStat
              value={summary.uniqueProjects.toLocaleString()}
              label="unique projects"
            />
          )}
          {summary.totalValue > 0 && (
            <SummaryStat value={fmtMoney(summary.totalValue)} label="total filed" />
          )}
          {summary.firstFiled && (
            <SummaryStat value={`since ${summary.firstFiled}`} label="" />
          )}
        </div>
      )}

      {/* Live permit card — the thing we're actually looking at */}
      {livePermit && (
        <LivePermitCard permit={livePermit} expandedDescriptions={expandedDescriptions} />
      )}

      {/* Prior work, grouped by year — capped at VISIBLE_LIMIT rows */}
      {dedupedHistory.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Prior work
          </span>
          {(() => {
            const allRows = years.flatMap((y) =>
              (byYear.get(y) ?? []).map((r) => ({ year: y, row: r }))
            );
            const visible = showAllPrior ? allRows : allRows.slice(0, VISIBLE_LIMIT);
            const hiddenCount = allRows.length - VISIBLE_LIMIT;

            const visibleByYear = new Map<string, DedupedRow[]>();
            for (const { year, row } of visible) {
              if (!visibleByYear.has(year)) visibleByYear.set(year, []);
              visibleByYear.get(year)!.push(row);
            }
            const visibleYears = [...visibleByYear.keys()];

            return (
              <>
                {visibleYears.map((year) => {
                  const rows = byYear.get(year)!;
                  const shownRows = visibleByYear.get(year)!;
                  const yearTotal = rows.reduce((s, r) => s + r.totalValue, 0);
                  return (
                    <div key={year}>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[11.5px] font-semibold text-foreground">{year}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {rows.length} project{rows.length === 1 ? "" : "s"}
                          {yearTotal > 0 && ` · ${fmtMoney(yearTotal)}`}
                        </span>
                      </div>
                      <div className="space-y-0.5 pl-1">
                        {shownRows.map((row) => (
                          <PriorPermitRow
                            key={row.representative.id}
                            row={row}
                            expandedDescriptions={expandedDescriptions}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!showAllPrior && hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPrior(true)}
                    className="text-[11px] text-primary font-medium hover:underline mt-1"
                  >
                    Show all {allRows.length} permits
                  </button>
                )}
                {showAllPrior && hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPrior(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground mt-1"
                  >
                    Collapse
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold text-foreground">{value}</span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
}

function LivePermitCard({
  permit,
  expandedDescriptions,
}: {
  permit: PermitHistoryRow;
  expandedDescriptions: boolean;
}) {
  const dateISO = permitDateISO(permit);
  const value = Number(permit.estimated_value ?? 0);
  const valueFmt = fmtMoney(value);
  const tone = statusTone(permit.status);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary-04 px-3 py-2">
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold uppercase tracking-wider">
          Live permit
        </span>
        {permit.permit_type && (
          <span className="text-[11px] font-medium text-foreground capitalize">
            {permit.permit_type}
          </span>
        )}
        {permit.status && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn("w-1.5 h-1.5 rounded-full", toneClasses(tone))} />
            <span className="capitalize">{permit.status}</span>
          </span>
        )}
      </div>
      {permit.description && (
        <p className="text-[11px] text-foreground leading-snug">
          {expandedDescriptions ? permit.description : permit.description.slice(0, 180) + (permit.description.length > 180 ? "…" : "")}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
        {dateISO && <span>{dateISO.slice(0, 10)}</span>}
        {valueFmt && <span>· {valueFmt}</span>}
        {permit.permit_number && (
          <span className="font-mono">· #{permit.permit_number}</span>
        )}
      </div>
    </div>
  );
}

function PriorPermitRow({
  row,
  expandedDescriptions,
}: {
  row: DedupedRow;
  expandedDescriptions: boolean;
}) {
  const p = row.representative;
  const dateISO = row.latestDateISO;
  const valueFmt = fmtMoney(row.totalValue);
  const tone = statusTone(p.status);

  return (
    <div className="flex items-start gap-2 text-[11px] py-0.5">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]", toneClasses(tone))} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {dateISO && (
            <span className="text-muted-foreground tabular-nums">
              {dateISO.slice(5, 10)}
            </span>
          )}
          <span className="text-foreground capitalize">
            {p.permit_type ?? "Permit"}
          </span>
          {p.status && (
            <span className="text-muted-foreground capitalize text-[10px]">
              {p.status}
            </span>
          )}
          {valueFmt && (
            <span className="text-muted-foreground">· {valueFmt}</span>
          )}
          {row.duplicates > 1 && (
            <span className="text-[9.5px] px-1 py-px rounded-full bg-bg-subtle text-muted-foreground">
              ×{row.duplicates} filings
            </span>
          )}
        </div>
        {p.description && expandedDescriptions && (
          <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            {p.description}
          </p>
        )}
      </div>
    </div>
  );
}
