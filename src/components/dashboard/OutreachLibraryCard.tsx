"use client";

import { useEffect, useState } from "react";
import { BookOpen, Copy, Check, Loader2, Mail, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Phase 0a wedge #10 — starter outreach-template library surface.
 *
 * Shows the seed templates from migration 00032 grouped by trade. Each
 * row has a one-click "Copy to my templates" button that POSTs to
 * /api/outreach/library and lands a fresh row in the contractor's own
 * outreach_templates, fully editable. Permit-specific tokens
 * ({{permit_number}}, {{address_short}}, {{owner_first}}, etc.) are
 * resolved at send-time by src/lib/outreach/tokens.ts.
 *
 * Renders nothing when the library is empty OR migration 00032 is
 * pending (parent Outreach page still renders the contractor's own
 * templates above this card).
 */

interface LibraryTemplate {
  id: string;
  trade: string | null;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
}

export function OutreachLibraryCard({ onCopied }: { onCopied?: () => void }) {
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  // A failed load used to render exactly like "no library exists" (the
  // component returned null), and a failed copy cleared the spinner with
  // no message at all.
  const [loadError, setLoadError] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/outreach/library", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setLoadError(true);
          return;
        }
        const body = (await res.json()) as {
          templates: LibraryTemplate[];
          migrationPending?: boolean;
        };
        if (!cancelled) {
          setLoadError(false);
          setTemplates(body.templates ?? []);
          setMigrationPending(!!body.migrationPending);
        }
      } catch {
        // The IIFE had no catch, so a network throw escaped as an
        // unhandled rejection.
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function copyToMine(id: string) {
    setCopying(id);
    setCopyError(null);
    try {
      const res = await fetch("/api/outreach/library", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: id }),
      });
      if (res.ok) {
        setJustCopied(id);
        setTimeout(() => setJustCopied(null), 1800);
        onCopied?.();
      } else {
        setCopyError(id);
      }
    } catch {
      setCopyError(id);
    } finally {
      setCopying(null);
    }
  }

  if (loading) return null;
  if (loadError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
      >
        <p className="text-[12px] text-destructive">
          Couldn&apos;t load the starter template library.
        </p>
        <button
          type="button"
          onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}
          className="text-[12px] font-medium text-destructive underline underline-offset-2 hover:opacity-80"
        >
          Retry
        </button>
      </div>
    );
  }
  if (migrationPending || templates.length === 0) {
    // Don't render a dead card when the seeds aren't live yet.
    return null;
  }

  // Group by trade, preserving insertion order.
  const byTrade = new Map<string, LibraryTemplate[]>();
  for (const t of templates) {
    const key = (t.trade ?? "other").toLowerCase();
    if (!byTrade.has(key)) byTrade.set(key, []);
    byTrade.get(key)!.push(t);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Starter template library</h3>
        <span className="text-[10px] text-muted-foreground">
          {templates.length} permit-specific openers · copy + edit any to make it yours
        </span>
      </div>
      <div className="divide-y divide-border">
        {[...byTrade.entries()].map(([trade, list]) => (
          <div key={trade}>
            <div className="px-4 py-2 bg-bg-subtle/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {trade}
            </div>
            {list.map((t) => {
              const isCopying = copying === t.id;
              const wasCopied = justCopied === t.id;
              const ChannelIcon =
                t.channel === "email" ? Mail : t.channel === "sms" ? MessageSquare : Mail;
              return (
                <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                  <ChannelIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[12.5px] font-medium text-foreground">{t.name}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {t.channel}
                      </span>
                    </div>
                    {t.subject && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        <span className="font-medium">Subject:</span> {t.subject}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
                      {t.body}
                    </p>
                    {copyError === t.id && (
                      <p role="alert" className="mt-1 text-[11px] text-destructive">
                        Couldn&apos;t copy that template — try again.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToMine(t.id)}
                    disabled={isCopying || wasCopied}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                      wasCopied
                        ? "border-success/40 bg-[rgba(61,153,112,0.10)] text-success"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {isCopying ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : wasCopied ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {wasCopied ? "Copied" : "Copy to mine"}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
