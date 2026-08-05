"use client";

import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { useMarketIntel, type MarketIntelTrade } from "@/hooks/useMarketIntel";
import { cn } from "@/lib/utils/cn";

/**
 * Phase 0b wedge #9 — market intelligence per ZIP.
 *
 * The thing that keeps contractors logged in even when they don't need
 * a lead. Trailing-90-day permit count, total value, top trades, top
 * active GCs, month-over-month trend. Refreshed nightly by the
 * /api/cron/market-intel cron.
 *
 * Input: a ZIP (contractor passes their primary territory, or user
 * types one into the search box). Shows a concise card.
 */

function formatValue(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function MarketIntelPanel({
  initialZip,
  className,
}: {
  initialZip?: string | null;
  className?: string;
}) {
  const [zip, setZip] = useState<string>(initialZip ?? "");
  const [input, setInput] = useState<string>(initialZip ?? "");
  const { intel, isLoading, migrationPending, error, refresh } = useMarketIntel(zip || null);

  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Market intel</h3>
          <span className="text-[10px] text-muted-foreground">trailing 90 days</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = input.slice(0, 5).replace(/[^0-9]/g, "");
            if (clean.length !== 5) return;
            // Re-submitting the SAME zip set identical state, so React
            // bailed out and nothing refetched — the only recovery from
            // an error was to type a different ZIP and back.
            if (clean === zip) refresh();
            else setZip(clean);
          }}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{5}"
            maxLength={5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ZIP"
            aria-label="ZIP code"
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded-md bg-cta text-cta-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Go
          </button>
        </form>
      </div>

      {migrationPending && (
        <div className="px-4 py-3 text-[11px] text-warm">
          Market-intel view not yet built. Apply migration{" "}
          <code className="font-mono">00034_market_intel_zip.sql</code> and run{" "}
          <code className="font-mono">/api/cron/market-intel</code> once.
        </div>
      )}

      {!migrationPending && !zip && (
        <div className="px-4 py-8 text-center text-[11.5px] text-muted-foreground">
          Type a ZIP to see permit volume, top trades, and the active GCs in
          that market.
        </div>
      )}

      {!migrationPending && zip && isLoading && (
        <div className="px-4 py-6 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading intel for {zip}…
        </div>
      )}

      {!migrationPending && zip && !isLoading && error && (
        <div className="px-4 py-6 text-[12px] text-destructive space-y-2" role="alert">
          <p>
            Couldn&apos;t load market intelligence for {zip}. Check your
            connection and try again.
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}

      {!migrationPending && zip && !isLoading && !error && !intel && (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">
          No recent permit activity in {zip}. Either the nightly refresh
          hasn&apos;t caught up or the ZIP genuinely has &lt;1 permit in the
          last 90 days.
        </div>
      )}

      {!migrationPending && !error && intel && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="Permits" value={intel.permit_count_90d.toLocaleString()} />
            <Metric label="Total value" value={formatValue(intel.total_value_90d)} />
            <Metric
              label="MoM"
              value={
                intel.permit_count_mom_delta_pct == null
                  ? "—"
                  : `${intel.permit_count_mom_delta_pct > 0 ? "+" : ""}${intel.permit_count_mom_delta_pct}%`
              }
              tone={
                intel.permit_count_mom_delta_pct == null
                  ? "muted"
                  : intel.permit_count_mom_delta_pct >= 10
                    ? "up"
                    : intel.permit_count_mom_delta_pct <= -10
                      ? "down"
                      : "muted"
              }
            />
          </div>

          {intel.top_trades.length > 0 && (
            <TradeList label="Top trades" items={intel.top_trades} />
          )}

          {intel.top_applicants.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Top active GCs / applicants
              </h4>
              <ul className="space-y-1">
                {intel.top_applicants.slice(0, 5).map((a, i) => (
                  <li
                    key={`${a.name}-${i}`}
                    className="flex items-center justify-between gap-2 text-[11.5px]"
                  >
                    <span className="text-foreground truncate" title={a.name}>
                      {a.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {a.count} · {formatValue(a.total_value)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Never silently drop rows. */}
              {intel.top_applicants.length > 5 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  +{intel.top_applicants.length - 5} more not shown
                </p>
              )}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/80">
            Refreshed{" "}
            {new Date(intel.as_of).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            {" "}· {intel.zip}
            {intel.state && ` · ${intel.state}`}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "muted";
}) {
  const color =
    tone === "up" ? "text-success" : tone === "down" ? "text-hot" : "text-foreground";
  return (
    <div>
      <p className={cn("text-lg font-semibold", color)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </p>
    </div>
  );
}

function TradeList({ label, items }: { label: string; items: MarketIntelTrade[] }) {
  const max = Math.max(...items.map((t) => t.count), 1);
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </h4>
      <div className="space-y-1">
        {items.slice(0, 5).map((t) => (
          <div key={t.trade} className="flex items-center gap-2 text-[11px]">
            <span className="w-[90px] shrink-0 truncate capitalize text-foreground" title={t.trade}>
              {t.trade}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${(t.count / max) * 100}%` }}
              />
            </div>
            <span className="text-muted-foreground shrink-0 tabular-nums w-16 text-right">
              {t.count} · {formatValue(t.total_value)}
            </span>
          </div>
        ))}
      </div>
      {items.length > 5 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          +{items.length - 5} more not shown
        </p>
      )}
    </div>
  );
}
