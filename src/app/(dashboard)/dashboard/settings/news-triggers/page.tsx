"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Newspaper, ExternalLink } from "lucide-react";
import { useGodMode } from "@/hooks/useGodMode";

/**
 * /dashboard/settings/news-triggers
 *
 * God-mode-only. Lists recent GDELT construction-trigger articles
 * (broke ground / ribbon cutting / new construction / etc.) for the
 * founder to scan. Useful as a pre-permit lead source — articles
 * about ground-breaking ceremonies typically precede the building
 * permit by 3-30 days.
 *
 * Lives under settings (deepens existing tab) per CLAUDE.md "do
 * not add new top-level tabs" rule.
 */

interface Article {
  trigger_uid: string;
  url: string;
  title: string | null;
  seen_date: string | null;
  domain: string | null;
  language: string | null;
  source_country: string | null;
  query_match: string | null;
}

interface Resp {
  ok: true;
  total_in_window: number;
  window_days: number;
  articles: Article[];
  domain_histogram: Record<string, number>;
  query_histogram: Record<string, number>;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 10);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export default function NewsTriggersPage() {
  const isGod = useGodMode();
  const [data, setData] = useState<Resp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryFilter, setQueryFilter] = useState("");
  const [days, setDays] = useState(30);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), limit: "100" });
      if (queryFilter) params.set("query", queryFilter);
      const res = await fetch(`/api/admin/news-triggers?${params}`, { cache: "no-store" });
      if (res.status === 403) {
        setError("Forbidden — god-mode access required.");
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as Resp);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, queryFilter]);

  if (!isGod && !isLoading && !data) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="rounded-lg border border-border bg-card/50 p-6 text-center text-fg-subtle">
          This page is restricted to god-mode accounts.
        </div>
      </main>
    );
  }

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
          <h1 className="font-heading text-2xl mt-1 text-foreground">News triggers</h1>
          <p className="text-[12px] text-fg-subtle mt-0.5">
            Pre-permit lead signals from GDELT — groundbreaking, ribbon cutting,
            new construction articles in the US.
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                Total in window
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5">
                {data.total_in_window.toLocaleString()}
              </div>
              <div className="text-[10px] text-fg-subtle/70 mt-0.5">
                across last {data.window_days} days
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
                Top queries
              </div>
              <div className="space-y-1">
                {Object.entries(data.query_histogram)
                  .slice(0, 5)
                  .map(([q, n]) => (
                    <div key={q} className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-mono text-fg-subtle/80 max-w-[80%]">
                        {q.replace(/sourcecountry:US/i, "").trim()}
                      </span>
                      <span className="tabular-nums font-medium">{n}</span>
                    </div>
                  ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
                Top domains
              </div>
              <div className="space-y-1">
                {Object.entries(data.domain_histogram)
                  .slice(0, 5)
                  .map(([d, n]) => (
                    <div key={d} className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-fg-subtle/80 max-w-[80%]">{d}</span>
                      <span className="tabular-nums font-medium">{n}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              placeholder="Filter by query (broke ground, ribbon cutting, …)"
              value={queryFilter}
              onChange={(e) => setQueryFilter(e.target.value)}
              className="flex-1 px-3 py-1.5 text-[12px] rounded-md border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1.5 text-[12px] rounded-md border border-border bg-card"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Title</th>
                  <th className="text-left px-3 py-2 font-semibold w-32">Domain</th>
                  <th className="text-left px-3 py-2 font-semibold w-32">Match</th>
                  <th className="text-right px-3 py-2 font-semibold w-16">Seen</th>
                  <th className="text-right px-3 py-2 font-semibold w-12"></th>
                </tr>
              </thead>
              <tbody>
                {data.articles.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={5} className="text-center px-3 py-12 text-fg-subtle">
                      <Newspaper className="inline h-4 w-4 mr-1 align-text-bottom" />
                      No articles in this window yet.
                    </td>
                  </tr>
                )}
                {data.articles.map((a) => (
                  <tr key={a.trigger_uid} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="text-foreground line-clamp-2">{a.title ?? "(no title)"}</div>
                    </td>
                    <td className="px-3 py-2 text-fg-subtle truncate max-w-[180px]">
                      {a.domain ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] font-mono text-fg-subtle/80">
                        {(a.query_match ?? "").replace(/sourcecountry:US/i, "").trim()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-fg-subtle tabular-nums">
                      {relativeDate(a.seen_date)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-fg-subtle hover:text-foreground"
                        title="Open article"
                      >
                        <ExternalLink className="h-3 w-3 inline" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
