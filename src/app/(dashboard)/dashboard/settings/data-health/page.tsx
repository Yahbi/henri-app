"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, AlertTriangle, AlertCircle, CircleDot, Database, Play, Loader2 } from "lucide-react";
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

interface CronRunInfo {
  started_at: string;
  duration_ms: number | null;
  status: "ok" | "error" | "partial";
  inserted: number | null;
  error: string | null;
  trigger: "cron" | "manual";
}

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
  recent_runs?: CronRunInfo[];
}

interface EnrichmentFill {
  total: number | null;
  owner_name_pct: number | null;
  phone_pct: number | null;
  email_pct: number | null;
  property_value_pct: number | null;
  year_built_pct: number | null;
  enriched_pct: number | null;
  score_max: number | null;
  hot_count: number | null;
}

interface HealthResponse {
  ok: true;
  generated_at: string;
  enrichment?: EnrichmentFill | null;
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
  /** cron_path → "running" | "ok: <summary>" | "fail: <msg>". Toast-style. */
  const [triggerState, setTriggerState] = useState<Record<string, string>>({});

  /** Sequentially fire every cron whose latest table state is empty
   *  / stale / error. UX shortcut for the "after a deploy, wake them
   *  all up at once" workflow without touching .env.local. */
  const triggerAllNeedy = async () => {
    if (!data) return;
    const needy = data.tables
      .filter((t) => t.status !== "ok")
      .map((t) => t.cron_path);
    if (needy.length === 0) return;
    if (!confirm(`Trigger ${needy.length} cron${needy.length === 1 ? "" : "s"} sequentially? This may take ~10 min.`)) return;
    for (const path of needy) {
      await triggerCron(path);
    }
  };

  const triggerCron = async (cronPath: string) => {
    setTriggerState((s) => ({ ...s, [cronPath]: "running" }));
    try {
      const res = await fetch("/api/admin/data-health/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron_path: cronPath }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        upstream?: { pulled?: number; inserted?: number; duration_ms?: number };
        error?: string;
        status?: number;
      };
      if (!res.ok || !body.ok) {
        setTriggerState((s) => ({
          ...s,
          [cronPath]: `fail (${body.status ?? res.status}): ${body.error ?? "see logs"}`,
        }));
        return;
      }
      const u = body.upstream ?? {};
      const parts: string[] = [];
      if (u.pulled != null) parts.push(`pulled ${u.pulled}`);
      if (u.inserted != null) parts.push(`inserted ${u.inserted}`);
      if (u.duration_ms != null) parts.push(`${(u.duration_ms / 1000).toFixed(1)}s`);
      setTriggerState((s) => ({
        ...s,
        [cronPath]: parts.length > 0 ? `ok · ${parts.join(" · ")}` : "ok",
      }));
      // Pull a fresh data-health snapshot so row counts reflect the run.
      void refresh();
    } catch (err) {
      setTriggerState((s) => ({ ...s, [cronPath]: `fail: ${String(err)}` }));
    }
  };

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
          <div className="flex items-center gap-3 mt-2 text-[11px]">
            <Link
              href="/dashboard/settings/news-triggers"
              className="text-primary hover:underline"
            >
              → News triggers (GDELT)
            </Link>
            <Link
              href="/dashboard/settings/foreclosures-reo"
              className="text-primary hover:underline"
            >
              → FHA REO foreclosures
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void triggerAllNeedy()}
            disabled={isLoading || !data || data.tables.every((t) => t.status === "ok")}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-md border border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Sequentially fire every cron whose table is empty / stale / error."
          >
            <Play className="h-3 w-3" />
            Trigger all needy
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-md border border-border bg-card hover:bg-card/80 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
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

      {data?.enrichment && (
        <div className="rounded-lg border border-border bg-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold text-foreground">
              Lead enrichment fill rates
            </h2>
            <span className="text-[11px] text-fg-subtle">
              {formatRows(data.enrichment.total)} leads ·{" "}
              {data.enrichment.hot_count ?? 0} hot · max score{" "}
              {data.enrichment.score_max ?? "—"}
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            <FillStat label="Owner" pct={data.enrichment.owner_name_pct} />
            <FillStat label="Phone" pct={data.enrichment.phone_pct} />
            <FillStat label="Email" pct={data.enrichment.email_pct} />
            <FillStat label="Prop. value" pct={data.enrichment.property_value_pct} />
            <FillStat label="Year built" pct={data.enrichment.year_built_pct} />
            <FillStat label="Enriched" pct={data.enrichment.enriched_pct} />
          </div>
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
                <th className="text-left px-3 py-2 font-semibold w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="text-center px-3 py-12 text-fg-subtle">
                    <Database className="inline h-4 w-4 mr-1 align-text-bottom" />
                    No data yet — first run will populate.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const trig = triggerState[r.cron_path];
                const running = trig === "running";
                const ok = trig?.startsWith("ok");
                const failed = trig?.startsWith("fail");
                return (
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
                    {r.recent_runs && r.recent_runs.length > 0 && (
                      <div
                        className="flex items-center gap-0.5 mt-1.5"
                        aria-label="Last 5 runs (most recent first)"
                      >
                        {r.recent_runs.map((run, i) => {
                          const cls =
                            run.status === "ok"
                              ? "bg-emerald-500/70"
                              : run.status === "error"
                                ? "bg-rose-500/80"
                                : "bg-amber-500/70";
                          const tooltip = [
                            `${run.status.toUpperCase()} (${run.trigger})`,
                            new Date(run.started_at).toLocaleString(),
                            run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : null,
                            run.inserted != null ? `inserted ${run.inserted}` : null,
                            run.error ? `error: ${run.error.slice(0, 100)}` : null,
                          ].filter(Boolean).join(" · ");
                          return (
                            <div
                              key={`${r.cron_path}-${i}`}
                              className={`h-2 w-3 rounded-sm ${cls}`}
                              title={tooltip}
                            />
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void triggerCron(r.cron_path)}
                      disabled={running}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                        running
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 cursor-wait"
                          : ok
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15"
                          : failed
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15"
                          : "border-border bg-card hover:bg-muted/40"
                      }`}
                      title={trig ?? "Trigger this cron now"}
                    >
                      {running ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      {running ? "Running…" : "Run now"}
                    </button>
                    {trig && !running && (
                      <div className={`text-[9px] mt-1 truncate max-w-[160px] ${
                        ok ? "text-emerald-700" : "text-rose-700"
                      }`}>
                        {trig}
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
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

function FillStat({ label, pct }: { label: string; pct: number | null }) {
  // Colour by health: green ≥40%, amber ≥10%, rose below — phone/email at
  // ~1% read rose, which is the point (it flags the gap to the operator).
  const v = pct ?? 0;
  const tone =
    v >= 40 ? "text-emerald-600" : v >= 10 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>
        {pct == null ? "—" : `${pct}%`}
      </div>
    </div>
  );
}
