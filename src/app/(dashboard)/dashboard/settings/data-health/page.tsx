"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, AlertTriangle, AlertCircle, CircleDot, Database } from "lucide-react";
import { useGodMode } from "@/hooks/useGodMode";

/**
 * /dashboard/settings/data-health
 *
 * God-mode-only sidecar-table freshness panel. Surfaces every Wave 1 /
 * 2.A / 2.B canonical-data-layer table with row count, last ingest
 * timestamp, last-24h insertions, and a status chip — catches dead
 * crons before they rot for 30 days. Source: /api/admin/data-health.
 *
 * Lives under settings rather than as a top-level dashboard tab per
 * CLAUDE.md ("do not add new top-level tabs — deepen existing tabs").
 */

interface HealthRow {
  table: string;
  cron_path: string;
  schedule: string;
  wave: string;
  description: string;
  total_rows: number | null;
  last_ingested_at: string | null;
  last_24h: number | null;
  status: "ok" | "stale" | "empty" | "error";
}

interface HealthResponse {
  ok: true;
  generated_at: string;
  tables: HealthRow[];
}

function formatRows(n: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 16).replace("T", " ");
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function StatusChip({ status }: { status: HealthRow["status"] }) {
  const cfg: Record<HealthRow["status"], { cls: string; label: string; Icon: typeof CircleDot }> = {
    ok:    { cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",   label: "OK",    Icon: CircleDot },
    stale: { cls: "bg-amber-500/10 text-amber-700 border-amber-500/20",         label: "STALE", Icon: AlertCircle },
    empty: { cls: "bg-slate-500/10 text-slate-700 border-slate-500/20",         label: "EMPTY", Icon: CircleDot },
    error: { cls: "bg-rose-500/10 text-rose-700 border-rose-500/20",            label: "ERROR", Icon: AlertTriangle },
  };
  const c = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${c.cls}`}
    >
      <c.Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}

export default function DataHealthPage() {
  const isGod = useGodMode();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/data-health", { cache: "no-store" });
      if (res.status === 403) {
        setError("Forbidden — god-mode access required.");
        setData(null);
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as HealthResponse;
      setData(body);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (!isGod && !isLoading && !data) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-lg border border-border bg-card/50 p-6 text-center text-fg-subtle">
          This page is restricted to god-mode accounts.
        </div>
      </main>
    );
  }

  const rows = data?.tables ?? [];
  const counts = {
    ok: rows.filter((r) => r.status === "ok").length,
    stale: rows.filter((r) => r.status === "stale").length,
    empty: rows.filter((r) => r.status === "empty").length,
    error: rows.filter((r) => r.status === "error").length,
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <div>
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to settings
          </Link>
          <h1 className="font-heading text-2xl mt-1 text-foreground">
            Data health
          </h1>
          <p className="text-[12px] text-fg-subtle mt-0.5">
            Sidecar canonical-data-layer freshness across Wave 1 / 2.A / 2.B.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-md border border-border bg-card hover:bg-card/80 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 mb-4 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SummaryCard count={counts.ok}    label="OK"    color="emerald" />
          <SummaryCard count={counts.stale} label="Stale" color="amber" />
          <SummaryCard count={counts.empty} label="Empty" color="slate" />
          <SummaryCard count={counts.error} label="Error" color="rose" />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-fg-subtle">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-left px-3 py-2 font-semibold">Table</th>
                <th className="text-left px-3 py-2 font-semibold">Wave</th>
                <th className="text-right px-3 py-2 font-semibold">Total rows</th>
                <th className="text-right px-3 py-2 font-semibold">Last 24h</th>
                <th className="text-left px-3 py-2 font-semibold">Last ingest</th>
                <th className="text-left px-3 py-2 font-semibold">Cron</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="text-center px-3 py-12 text-fg-subtle">
                    <Database className="inline h-4 w-4 mr-1 align-text-bottom" />
                    No data yet — first run will populate.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.table} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[11px] text-foreground">{r.table}</div>
                    <div className="text-[10px] text-fg-subtle/70 mt-0.5">{r.description}</div>
                  </td>
                  <td className="px-3 py-2 text-fg-subtle">{r.wave}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatRows(r.total_rows)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.last_24h == null ? "—" : formatRows(r.last_24h)}
                  </td>
                  <td className="px-3 py-2 text-fg-subtle">
                    {formatRelative(r.last_ingested_at)}
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-[10px] font-mono text-fg-subtle">
                      /api/cron/{r.cron_path}
                    </code>
                    <div className="text-[10px] text-fg-subtle/60 mt-0.5">
                      <code>{r.schedule}</code>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && (
        <p className="text-[10px] text-fg-subtle/60 mt-3 text-right">
          Generated {formatRelative(data.generated_at)} · god-mode only
        </p>
      )}
    </main>
  );
}

function SummaryCard({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "emerald" | "amber" | "slate" | "rose";
}) {
  const cls: Record<typeof color, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-700",
    amber:   "border-amber-500/20 bg-amber-500/5 text-amber-700",
    slate:   "border-slate-500/20 bg-slate-500/5 text-slate-700",
    rose:    "border-rose-500/20 bg-rose-500/5 text-rose-700",
  };
  return (
    <div className={`rounded-lg border p-3 ${cls[color]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{count}</div>
    </div>
  );
}
