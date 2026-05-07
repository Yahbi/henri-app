"use client";

import { cn } from "@/lib/utils/cn";
// 2026-04-30: ExclusivityBadge + WatchersBadge are no longer rendered.
// The lock + watcher infrastructure exists in DB and API but no UI
// path acquires a lock, so the badge surfaces were silent overclaims.
// See ~/.claude/plans/whats-the-14-days-purring-papert.md.
// The components themselves stay on disk (zero cost, easy to revive).
import type { ExclusivityLeadSummary } from "@/lib/exclusivity/locks";

export interface LeadData {
  id: string;
  addr: string;
  zip: string;
  fullAddress: string;
  score: number;
  owner: string;
  firstName: string;
  lastName: string;
  coOwner?: string;
  phone: string;
  phone2?: string;
  email: string;
  email2?: string;
  mailing?: string;
  type: string;
  value: string;
  propertyValue?: string;
  assessedValue?: string;
  yearBuilt?: number;
  lotSqft?: string;
  homeSqft?: string;
  ownerSince?: string;
  ownerOccupied?: boolean;
  permitDescription?: string;
  permitNumber?: string;
  /** Supabase UUID of the backing `permits` row — used by the project
   *  stage timeline to fetch `permit_events`. Separate from
   *  `permitNumber` which is the jurisdiction-issued string. */
  permitUuid?: string;
  filedDate?: string;
  /** Phase 0b timeline: lifecycle dates read off the permits join. */
  appliedDate?: string;
  issuedDate?: string;
  completedDate?: string;
  permitStatus?: string;
  permitHistory?: string[];
  cascade?: boolean;
  cascadeCount?: number;
  permitAge?: number;
  freshScore?: number;
  valueScore?: number;
  contactScore?: number;
  demandScore?: number;
  engagementScore?: number;
  conversionScore?: number;
  /** Phase 0a transparency: typed signal breakdown written by the scorer
   *  into `leads.score_signals`. The drawer renders this when present;
   *  falls back to the 4 legacy numeric fields when null. */
  scoreSignals?: unknown;
  status?: string;
  trade?: string;
  isHomeowner?: boolean;
  lat?: number | null;
  lng?: number | null;
  cityState?: string;
  rawValue?: number;

  /* ── Extended enrichment fields (migration 00044) ──────────────
   *
   * Optional. Populated by `/api/cron/enrich/route.ts` when the
   * orchestrator gets hits from FEC (employer/occupation), CSLB
   * (license_number/status), Google/Yelp (business_status), or PPP
   * (naics_code). All UI rendering is `if (lead.X) {…}`-gated so
   * leads without these fields render unchanged.
   *
   * Source labels live on `leads.contact_source` (migration 00039);
   * the drawer can display "from CSLB" etc. when WRITE_PROVENANCE
   * is enabled. */
  employer?: string;
  occupation?: string;
  businessPhone?: string;       // contractor's number, distinct from owner phone
  businessStatus?: string;      // OPERATIONAL / CLOSED_*
  businessWebsite?: string;
  licenseNumber?: string;
  licenseStatus?: string;       // active / expired / suspended
  naicsCode?: string;
  contactSource?: string;       // primary source attribution
  contactConfidence?: number;   // 0..1

  /* Phase 1.2 predictive cross-trade suggestions
   * Populated by the cron scorer from `leads.cross_trade_suggestions`
   * jsonb (migration 00045). Each entry is a CrossTradeSuggestion from
   * `src/lib/predictive/rules.ts`. Drawer's CrossTradeOpportunities
   * component renders these; nullable / undefined for graceful-degrade
   * when the migration hasn't applied yet. */
  crossTradeSuggestions?: unknown;

  /* Phase 1.3 DIY-vs-pro permit-applicant fields. Pulled directly from
   * `permits.applicant_name` + `permits.contractor_name` (migration
   * 00004 columns). Used by the ApplicantBadge component in the drawer
   * to render a "Homeowner-pulled / Pulled by ACME LLC / Spec" chip. */
  permitApplicantName?: string;
  permitContractorName?: string;
}

/* Score pill color — switched from hardcoded `bg-[rgba(...)]` literals
 * to `color-mix()` over the canonical `--hot / --warm / --cool` tokens.
 * If the brand palette ever shifts, the pill colour propagates from the
 * token definition instead of requiring a grep-and-replace. The 10%
 * opacity is the same visual result as the old rgba values.
 *
 * Shape is kept as a circle (w-9 h-9 rounded-full) rather than routed
 * through the Badge primitive — Badge is pill-shaped, and the distinct
 * circular score dot is a deliberate visual anchor on each card. */
function scoreColor(score: number) {
  if (score >= 75) return "text-hot bg-[color-mix(in_srgb,var(--hot)_10%,transparent)]";
  if (score >= 50) return "text-warm bg-[color-mix(in_srgb,var(--warm)_10%,transparent)]";
  return "text-cool bg-[color-mix(in_srgb,var(--cool)_10%,transparent)]";
}

/* Trade palette mapping — each trade points at the CSS-var token pair
 * in globals.css (`--trade-*-fg` / `--trade-*-tint`). Adding a new trade
 * here requires NO style change: define the tokens in globals.css, add
 * the slug below, and the badge renders with the new colors across
 * the whole app (LeadCard, Kanban chip, filter bar — any consumer of
 * `tradeBadgeStyle`).
 *
 * Kept as a slug list rather than a literal CSS-var lookup so a
 * typo'd trade still falls back to `general` instead of leaking
 * `var(--trade-typo-fg)` → empty cascade → invisible pill. */
const TRADE_SLUGS = [
  "roofing", "hvac", "plumbing", "electrical", "solar", "adu",
] as const;
type TradeSlug = typeof TRADE_SLUGS[number] | "general";

function tradeSlug(trade?: string): TradeSlug {
  if (!trade) return "general";
  const key = trade.toLowerCase().trim();
  return (TRADE_SLUGS as readonly string[]).includes(key)
    ? (key as TradeSlug)
    : "general";
}

function tradeBadgeStyle(trade?: string): { bg: string; text: string } {
  const slug = tradeSlug(trade);
  return {
    bg: `var(--trade-${slug}-tint)`,
    text: `var(--trade-${slug}-fg)`,
  };
}

function urgencyDot(permitAge?: number): "red" | "yellow" | null {
  if (permitAge == null || permitAge < 0) return null;
  if (permitAge <= 3) return "red";
  if (permitAge <= 10) return "yellow";
  return null;
}

interface LeadCardProps {
  lead: LeadData;
  active?: boolean;
  onClick?: () => void;
  /** Phase 0a: exclusivity lock + coarse watcher-bucket summary for
   *  this lead. Falsy when migration 00031 isn't live or the endpoint
   *  failed — both badges simply don't render in those cases. The
   *  watcher bucket is the wedge-#6 competitive-intel pill: "1-2 / 3-5
   *  / 5+ watching", never a raw count. */
  exclusivity?: ExclusivityLeadSummary | null;
  /** True when ≥ 2 leads in the parent list share this address
   *  (the wedge-#1 "one permit, multiple trade slots" case). Renders a
   *  compact trade + short-UUID chip below the address so the user can
   *  tell which row is which. Off by default — most leads have unique
   *  addresses in a typical territory. */
  disambiguate?: boolean;
}

export function LeadCard({ lead, active, onClick, exclusivity: _exclusivity, disambiguate }: LeadCardProps) {
  const score = lead.score;
  const badge = tradeBadgeStyle(lead.trade);
  const dot = urgencyDot(lead.permitAge);

  /* Disambiguation suffix — last 4 chars of the permit UUID. Always a
   * stable identifier even when trades match (rare but real — one
   * permit can have two cascade-duplicated lead rows as the scorer
   * re-enriches). Permit UUID is the unambiguous source of truth. */
  const disambiguator =
    disambiguate && lead.permitUuid
      ? lead.permitUuid.slice(-4).toUpperCase()
      : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-l-3 transition-colors",
        active
          ? "border-l-primary bg-primary-04"
          : "border-l-transparent hover:bg-bg-subtle"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {lead.addr}
            {disambiguator && (
              <span
                className="ml-1.5 inline-block align-middle text-[10px] font-mono font-normal text-muted-foreground bg-bg-subtle px-1.5 py-0.5 rounded"
                title={`This address has multiple leads — permit ID suffix: ${disambiguator}`}
              >
                #{disambiguator}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {lead.cascade && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary-08 px-1.5 py-0.5 rounded">
                <span className="text-xs">&#9670;</span> Cascade
              </span>
            )}
            {lead.trade && (
              <span
                className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-tight"
                style={{ backgroundColor: badge.bg, color: badge.text }}
              >
                {lead.trade}
              </span>
            )}
            <span className="text-[12px] text-muted-foreground truncate">
              {lead.type}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {lead.cityState || lead.zip?.split(" \u00B7 ")[0]}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {lead.value}
            </span>
          </div>
          {lead.permitDescription && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate leading-tight">
              {lead.permitDescription}
            </p>
          )}
          <p className="text-[11px] text-fg-subtle mt-1 inline-flex items-center gap-1.5">
            {dot && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: dot === "red" ? "#DC4A3D" : "#D4A24A",
                }}
              />
            )}
            {lead.permitAge != null && lead.permitAge >= 0
              ? `Permit ${lead.permitAge} days ago`
              : "Recent permit"}
          </p>
        </div>
        <div
          className={cn(
            "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold",
            scoreColor(score)
          )}
        >
          {score}
        </div>
      </div>
    </button>
  );
}
