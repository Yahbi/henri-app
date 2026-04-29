"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Kanban,
  Lightbulb,
  BarChart3,
  Send,
  Footprints,
  Calculator,
  TrendingUp,
  ShieldCheck,
  CloudLightning,
  Star,
  Banknote,
  Megaphone,
  Settings,
  Briefcase,
  MessageSquare,
  Search,
  MessageCircle,
} from "lucide-react";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { cn } from "@/lib/utils/cn";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { NotificationDropdown } from "@/components/dashboard/NotificationDropdown";
import { useLeads } from "@/hooks/useLeads";
import { useUser } from "@/hooks/useUser";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// Tab order groups tabs by the verb the contractor is doing:
//   lead work       → Leads · Pipeline · Delivery (pick → move → close)
//     (Leads tab already shows the map alongside the list — a separate
//     Map tab was duplicative and confused users into thinking they
//     were different surfaces. Removed per founder feedback.)
//   intel + reach   → Intel · Analytics · Outreach · Estimate · ROI
//   risk + events   → Compliance · Storm
//   stub surfaces   → Canvass · Reputation · Financing · Blast
//     (These have UI but no real backend — gated on NEXT_PUBLIC_ENABLE_STUB_TABS
//     so paying contractors don't see features that don't actually work.
//     Phase 3.1.)
//   talk            → Messages
const CORE_TABS = [
  { href: "/dashboard", label: "Leads", icon: LayoutDashboard },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/dashboard/jobs", label: "Delivery", icon: Briefcase },
  { href: "/dashboard/intel", label: "Intel", icon: Lightbulb },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/outreach", label: "Outreach", icon: Send },
  { href: "/dashboard/estimate", label: "Estimate", icon: Calculator },
  { href: "/dashboard/roi", label: "ROI", icon: TrendingUp },
  { href: "/dashboard/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/dashboard/storm", label: "Storm", icon: CloudLightning },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
] as const;

const STUB_TABS = [
  { href: "/dashboard/canvass", label: "Canvass", icon: Footprints },
  { href: "/dashboard/reputation", label: "Reputation", icon: Star },
  { href: "/dashboard/financing", label: "Financing", icon: Banknote },
  { href: "/dashboard/blast", label: "Blast", icon: Megaphone },
] as const;

const STUBS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_STUB_TABS === "1";

const TABS = STUBS_ENABLED ? [...CORE_TABS, ...STUB_TABS] : CORE_TABS;

// Module-scoped cache so navigating between dashboard tabs doesn't re-fetch
// 5,601 rows of territories every mount. Keyed by user id; 5-minute TTL.
// Phase 2.6 — before this, every tab click fired the paginated territory
// query, adding 1-2s of latency and hammering Supabase.
// `Map` is shadowed by the lucide-react Map icon import above, so reach
// through globalThis for the real constructor.
type TerritoryCacheEntry = { zips: string[]; fetchedAt: number };
const TERRITORY_CACHE: globalThis.Map<string, TerritoryCacheEntry> =
  new globalThis.Map<string, TerritoryCacheEntry>();
const TERRITORY_TTL_MS = 5 * 60 * 1000;

function TerritoryPill() {
  const { user } = useUser();
  const [territories, setTerritories] = useState<string[]>(() => {
    // Prime from cache synchronously on first render if still fresh —
    // skips the skeleton flash entirely when navigating between tabs.
    if (!user) return [];
    const cached = TERRITORY_CACHE.get(user.id);
    if (cached && Date.now() - cached.fetchedAt < TERRITORY_TTL_MS) {
      return cached.zips;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    if (!user) return false;
    const cached = TERRITORY_CACHE.get(user.id);
    return !(cached && Date.now() - cached.fetchedAt < TERRITORY_TTL_MS);
  });

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const cached = TERRITORY_CACHE.get(user.id);
    if (cached && Date.now() - cached.fetchedAt < TERRITORY_TTL_MS) {
      setTerritories(cached.zips);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    // Paginate around the PostgREST 1000-row silent cap (founder has
    // 5,601 claimed ZIPs). Also: the prior single-query promise chain
    // had no error branch, so any fetch failure left the skeleton
    // stuck forever. Now try/catch flips `loading=false` in all paths.
    let cancelled = false;
    (async () => {
      try {
        const PAGE = 1000;
        const zips: string[] = [];
        for (let offset = 0; offset < 60_000; offset += PAGE) {
          const { data, error } = await supabase
            .from("territories")
            .select("zip")
            .eq("contractor_id", user.id)
            .range(offset, offset + PAGE - 1);
          if (error || !data || data.length === 0) break;
          zips.push(...(data as { zip: string }[]).map((t) => t.zip).filter(Boolean));
          if (data.length < PAGE) break;
        }
        if (!cancelled) {
          setTerritories(zips);
          TERRITORY_CACHE.set(user.id, { zips, fetchedAt: Date.now() });
        }
      } catch {
        // Silent fail — the pill simply won't render; better than an
        // eternal skeleton.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Count new leads across all territories
  const { data: newLeads } = useLeads({ filters: { status: "new" } });
  const waitingCount = newLeads?.length ?? 0;

  if (loading) {
    return <Skeleton className="h-6 w-32 rounded-full" />;
  }

  if (territories.length === 0) return null;

  // Readability fix: the prior "ZIP +N-1" display looked like a giant
  // count (e.g. "57106 +5599" read as "57 thousand"). Small-territory
  // contractors still see the ZIP; at scale we collapse to a count so
  // the chip is honestly parseable at a glance.
  const display = territories.length === 1
    ? `ZIP ${territories[0]}`
    : territories.length <= 6
      ? `${territories.length} ZIPs`
      : `${territories.length.toLocaleString()} territories`;

  return (
    <Link
      href="/dashboard/settings#territories"
      className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border border-border text-xs font-medium text-primary bg-primary-04 hover:bg-primary-08 transition-colors"
      aria-label={`${territories.length.toLocaleString()} territories, ${waitingCount} leads waiting`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
      <span>
        {display} &middot; {waitingCount.toLocaleString()} waiting
      </span>
    </Link>
  );
}

/**
 * Displays the contractor's plan name + a status indicator:
 *   – "Trial ends in Xh" if in the 24-hour free trial
 *   – a red dot if the license expired (leads paused per CLAUDE.md)
 *   - "Licensed" otherwise
 *
 * Reads from `useUser().profile`. Silent no-op if the profile hasn't
 * loaded yet — avoids flashing placeholder text in the TopBar.
 */
function BillingStatePill() {
  const { profile } = useUser();
  // Mount-time reference so trial/license countdowns are stable per render
  const [mountNow] = useState(() => Date.now());
  if (!profile) return null;

  const planLabel = PLAN_LABELS[profile.plan ?? "founder"] ?? "Founder";

  // Trial countdown — Stripe-created subscriptions with trial_period_days=1
  // put `profile.trial_ends_at` on the row (webhook writes it).
  const trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const trialRemainingMs = trialEnd ? trialEnd.getTime() - mountNow : 0;
  const inTrial = trialRemainingMs > 0;
  const trialHours = Math.max(0, Math.ceil(trialRemainingMs / 3_600_000));

  // License expiration.
  const licensedUntil = profile.licensed_until ? new Date(profile.licensed_until) : null;
  const licenseExpired = licensedUntil ? licensedUntil.getTime() < mountNow : false;

  const tone = licenseExpired
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : inTrial
      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
      : "bg-primary-04 text-primary border-primary/20";

  return (
    <Link
      href="/dashboard/settings"
      className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${tone}`}
      aria-label={`Plan ${planLabel}, ${inTrial ? `trial ends in ${trialHours}h` : licenseExpired ? "license expired" : "licensed"}`}
    >
      <span>{planLabel}</span>
      <span className="opacity-50">·</span>
      {licenseExpired ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          <span>License expired</span>
        </>
      ) : inTrial ? (
        <span>Trial ends in {trialHours}h</span>
      ) : (
        <span>Licensed</span>
      )}
    </Link>
  );
}

const PLAN_LABELS: Record<string, string> = {
  founder: "Founder",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function DashboardTopBar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  // Trigger command palette via custom DOM event
  const openPalette = useCallback(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border">
      {/* Top row: logo + controls */}
      <div className="flex items-center justify-between h-12 px-4">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
          <span className="font-heading text-xl text-primary font-medium tracking-tight">
            Henri.
          </span>
        </Link>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Territory pill */}
          <TerritoryPill />

          {/* Billing state pill — plan / trial countdown / licensing flag */}
          <BillingStatePill />

          {/* Search (Cmd+K) */}
          <button
            onClick={openPalette}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Open command palette (Cmd+K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
            <kbd className="ml-1 font-mono text-[10px] text-muted-foreground/70">⌘K</kbd>
          </button>
          <button
            onClick={openPalette}
            className="flex sm:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Notifications */}
          <NotificationDropdown />

          {/* Feedback — tuck next to notifications so it's always one
              click away from wherever the contractor is working. */}
          <FeedbackTrigger />

          {/* Settings */}
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Account settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          <ThemeSwitcher />
        </div>
      </div>

      {/* Tab strip */}
      <nav
        className="flex items-center gap-0.5 px-4 overflow-x-auto scrollbar-none"
        role="tablist"
        aria-label="Dashboard navigation"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors shrink-0",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/**
 * Small topbar button that opens the feedback dialog. Kept in this
 * file because it's specific to the contractor TopBar layout — the
 * homeowner portal uses its own inline trigger styled to match that
 * surface.
 */
function FeedbackTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Send feedback"
        title="Send feedback"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
