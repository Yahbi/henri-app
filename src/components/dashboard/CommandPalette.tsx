"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLeads } from "@/hooks/useLeads";
import { cn } from "@/lib/utils/cn";
import { FocusTrap } from "@/components/ui/focus-trap";

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  category: "lead" | "nav" | "setting";
  action: () => void;
}

const NAV_COMMANDS: Omit<CommandItem, "action">[] = [
  { id: "nav-dashboard", label: "Dashboard", sublabel: "Leads feed + map", category: "nav" },
  { id: "nav-map", label: "Map", sublabel: "Full-screen permit + overlay map", category: "nav" },
  { id: "nav-pipeline", label: "Pipeline", sublabel: "Kanban by stage", category: "nav" },
  { id: "nav-jobs", label: "Delivery", sublabel: "Won leads \u2192 jobs", category: "nav" },
  { id: "nav-intel", label: "Intel", sublabel: "Market + competitive intelligence", category: "nav" },
  { id: "nav-analytics", label: "Analytics", category: "nav" },
  { id: "nav-outreach", label: "Outreach", sublabel: "Templates + library", category: "nav" },
  { id: "nav-canvass", label: "Canvass", category: "nav" },
  { id: "nav-estimate", label: "Estimate", category: "nav" },
  { id: "nav-roi", label: "ROI", category: "nav" },
  { id: "nav-compliance", label: "Compliance", category: "nav" },
  { id: "nav-storm", label: "Storm", category: "nav" },
  { id: "nav-blast", label: "Blast", category: "nav" },
  { id: "nav-messages", label: "Messages", category: "nav" },
  { id: "nav-reputation", label: "Reputation", category: "nav" },
];

const SETTING_COMMANDS: Omit<CommandItem, "action">[] = [
  { id: "set-account", label: "Account settings", category: "setting" },
  { id: "set-territories", label: "Territory management", category: "setting" },
  { id: "set-capacity", label: "Capacity", sublabel: "Hide leads outside your working envelope", category: "setting" },
  { id: "set-notifications", label: "Notification preferences", category: "setting" },
  { id: "set-billing", label: "Billing & plan", category: "setting" },
  { id: "set-referrals", label: "Referrals", category: "setting" },
  { id: "set-interviews", label: "Contractor interviews", sublabel: "Validation log (Phase 0 wedge)", category: "setting" },
];

const NAV_HREFS: Record<string, string> = {
  "nav-dashboard": "/dashboard",
  "nav-map": "/dashboard/map",
  "nav-pipeline": "/dashboard/pipeline",
  "nav-jobs": "/dashboard/jobs",
  "nav-intel": "/dashboard/intel",
  "nav-analytics": "/dashboard/analytics",
  "nav-outreach": "/dashboard/outreach",
  "nav-canvass": "/dashboard/canvass",
  "nav-estimate": "/dashboard/estimate",
  "nav-roi": "/dashboard/roi",
  "nav-compliance": "/dashboard/compliance",
  "nav-storm": "/dashboard/storm",
  "nav-blast": "/dashboard/blast",
  "nav-messages": "/dashboard/messages",
  "nav-reputation": "/dashboard/reputation",
  "set-account": "/settings/account",
  "set-territories": "/settings/territories",
  "set-capacity": "/settings/capacity",
  "set-notifications": "/settings/notifications",
  "set-billing": "/settings/billing",
  "set-referrals": "/settings/referrals",
  "set-interviews": "/settings/interviews",
};

const CATEGORY_LABELS: Record<string, string> = {
  lead: "Leads",
  nav: "Navigation",
  setting: "Settings",
};

export function CommandPalette() {
  const router = useRouter();
  const { data: leads = [], isLoading: leadsLoading } = useLeads();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build full command list — memoized to avoid rebuilding on every render
  const navigate = useCallback((href: string) => {
    router.push(href);
    setOpen(false);
  }, [router]);

  const allCommands = useMemo<CommandItem[]>(() => [
    ...NAV_COMMANDS.map((c) => ({
      ...c,
      action: () => navigate(NAV_HREFS[c.id]),
    })),
    ...SETTING_COMMANDS.map((c) => ({
      ...c,
      action: () => navigate(NAV_HREFS[c.id]),
    })),
    ...leads.slice(0, 20).map((lead) => ({
      id: `lead-${lead.id}`,
      label: (lead.address as string) ?? "Unknown address",
      sublabel: `${lead.trade ?? ""} · Score ${lead.score ?? 0}`,
      category: "lead" as const,
      // `?focus=` is the param the dashboard actually honors (see the
      // focusLeadId effect in (dashboard)/dashboard/page.tsx). The earlier
      // `?lead=` was read by nothing, so picking a lead in the palette
      // navigated to /dashboard and silently did nothing.
      action: () => navigate(`/dashboard?focus=${lead.id}`),
    })),
  ], [leads, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      (c.sublabel ?? "").toLowerCase().includes(q)
    );
  }, [query, allCommands]);

  // Group by category
  const grouped = useMemo(() =>
    filtered.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
      if (!acc[cmd.category]) acc[cmd.category] = [];
      acc[cmd.category].push(cmd);
      return acc;
    }, {}),
  [filtered]);

  // Flat list for keyboard navigation
  const flat = useMemo(() => Object.values(grouped).flat(), [grouped]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setActiveIndex(0);
    }
  }, [open]);

  // Keep the active option within the scroll container as the user arrows
  // through the list. aria-activedescendant tracks the active row but does
  // NOT auto-scroll it — without this, arrowing past the visible rows moves
  // the highlighted option below the fold (WCAG 2.4.7).
  useEffect(() => {
    if (!open) return;
    const id = flat[activeIndex]?.id;
    if (id) document.getElementById(`cmd-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flat, open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[activeIndex]) {
      // preventDefault so the keypress doesn't also submit an ancestor form
      // (the palette can mount inside one) after we've navigated away.
      e.preventDefault();
      flat[activeIndex].action();
    }
  }, [flat, activeIndex]);

  if (!open) return null;

  let globalIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      {/* Panel */}
      <FocusTrap active={open}>
      <div className="relative z-10 w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground shrink-0" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search leads, pages, settings..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            role="combobox"
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-expanded={flat.length > 0}
            aria-controls="command-palette-listbox"
            aria-activedescendant={flat[activeIndex] ? `cmd-${flat[activeIndex].id}` : undefined}
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[360px] overflow-y-auto py-2"
          id="command-palette-listbox"
          role="listbox"
          aria-label="Command results"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {leadsLoading ? "Loading leads..." : <>No results for &ldquo;{query}&rdquo;</>}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {CATEGORY_LABELS[category]}
                </div>
                {items.map((item) => {
                  const isActive = flat[activeIndex]?.id === item.id;
                  const idx = globalIndex++;
                  void idx; // used for ordering
                  return (
                    <button
                      key={item.id}
                      id={`cmd-${item.id}`}
                      onClick={item.action}
                      role="option"
                      aria-selected={isActive}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                        isActive
                          ? "bg-primary-08 text-foreground"
                          : "text-foreground hover:bg-bg-subtle"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.label}</p>
                        {item.sublabel && (
                          <p className="text-xs text-muted-foreground truncate">{item.sublabel}</p>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="shrink-0 text-[10px] font-mono text-muted-foreground border border-border rounded px-1 py-0.5">
                          Enter
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {/* Leads still fetching — show a placeholder row under its own
              category header so the palette doesn't look like the account
              has zero leads while the query is in flight. */}
          {leadsLoading && flat.length > 0 && !grouped.lead && (
            <div>
              <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {CATEGORY_LABELS.lead}
              </div>
              <div className="px-4 py-2 text-sm text-muted-foreground" aria-live="polite">
                Loading leads...
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
