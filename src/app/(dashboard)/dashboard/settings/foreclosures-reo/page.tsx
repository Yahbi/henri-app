"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Home as HomeIcon, MapPin } from "lucide-react";
import { useGodMode } from "@/hooks/useGodMode";

/**
 * /dashboard/settings/foreclosures-reo
 *
 * God-mode-only. Lists FHA REO foreclosure listings (Wave 1 sidecar
 * `foreclosures_fha`). REO properties typically need cleanout +
 * repairs + repaints before lender resale — high-intent
 * pre-listing-prep signal for general contractors.
 *
 * Lives under settings (deepens existing tab) per CLAUDE.md "do
 * not add new top-level tabs" rule.
 */

interface Listing {
  case_num: string;
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_date: string | null;
  list_price: number | null;
}

interface Resp {
  ok: true;
  total_in_window: number;
  window_days: number;
  listings: Listing[];
  state_histogram: Record<string, number>;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

function fmtCurrency(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso + "T00:00:00Z").getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default function ForeclosuresReoPage() {
  const isGod = useGodMode();
  const [data, setData] = useState<Resp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [zipFilter, setZipFilter] = useState("");
  const [days, setDays] = useState(365);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), limit: "200" });
      if (stateFilter) params.set("state", stateFilter);
      if (zipFilter) params.set("zip", zipFilter);
      const res = await fetch(`/api/admin/foreclosures-reo?${params}`, { cache: "no-store" });
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
  }, [days, stateFilter, zipFilter]);

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
          <h1 className="font-heading text-2xl mt-1 text-foreground">FHA REO foreclosures</h1>
          <p className="text-[12px] text-fg-subtle mt-0.5">
            Pre-listing-prep lead signals — foreclosed properties needing
            cleanout / repairs / repaints before resale.
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                Total in window
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5">
                {data.total_in_window.toLocaleString()}
              </div>
              <div className="text-[10px] text-fg-subtle/70 mt-0.5">
                listings · last {data.window_days} days
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
                Top states
              </div>
              <div className="grid grid-cols-3 gap-1">
                {Object.entries(data.state_histogram).slice(0, 9).map(([s, n]) => (
                  <div key={s} className="text-[11px] flex items-baseline gap-1">
                    <span className="font-medium">{s}</span>
                    <span className="text-fg-subtle/70 tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="px-3 py-1.5 text-[12px] rounded-md border border-border bg-card"
            >
              <option value="">All states</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              placeholder="ZIP"
              value={zipFilter}
              onChange={(e) => setZipFilter(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="w-24 px-3 py-1.5 text-[12px] rounded-md border border-border bg-card"
            />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1.5 text-[12px] rounded-md border border-border bg-card"
            >
              <option value={30}>Last 30d</option>
              <option value={90}>Last 90d</option>
              <option value={365}>Last year</option>
              <option value={3650}>All time</option>
            </select>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Property</th>
                  <th className="text-left px-3 py-2 font-semibold w-32">City / State</th>
                  <th className="text-left px-3 py-2 font-semibold w-20">ZIP</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">List Price</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">Listed</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={5} className="text-center px-3 py-12 text-fg-subtle">
                      <HomeIcon className="inline h-4 w-4 mr-1 align-text-bottom" />
                      No foreclosure listings in this window.
                    </td>
                  </tr>
                )}
                {data.listings.map((l) => (
                  <tr key={l.case_num} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="text-foreground">{l.street || "(address withheld)"}</div>
                      <div className="text-[10px] text-fg-subtle/70 mt-0.5 font-mono">
                        case #{l.case_num}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-fg-subtle">
                      <MapPin className="h-3 w-3 inline mr-1 align-text-bottom" />
                      {l.city ?? "—"} {l.state ?? ""}
                    </td>
                    <td className="px-3 py-2 text-fg-subtle font-mono text-[11px]">
                      {l.zip ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {fmtCurrency(l.list_price)}
                    </td>
                    <td className="px-3 py-2 text-right text-fg-subtle tabular-nums">
                      {relativeDate(l.list_date)}
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
