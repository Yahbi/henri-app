"use client";

import { cn } from "@/lib/utils/cn";
import { Bookmark } from "lucide-react";
// 2026-04-30: ExclusivityBadge + WatchersBadge are no longer rendered.
// The lock + watcher infrastructure exists in DB and API but no UI
// path acquires a lock, so the badge surfaces were silent overclaims.
// See ~/.claude/plans/whats-the-14-days-purring-papert.md.
// The components themselves stay on disk (zero cost, easy to revive).
import type { ExclusivityLeadSummary } from "@/lib/exclusivity/locks";
import type { PropertyType } from "@/lib/permits/property-classifier";
// Module 22 (2026-05-09) — single-source palette for stage tinting in
// the LeadCard left-border + inline chip dot. Same colors used by the
// drawer chip, the map pin paint, and the popup chip.
import { paletteFor } from "@/lib/intent/stage-colors";

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

  /* Intent classification (migration 00087 / Module 1). Optional —
   * pre-backfill rows render without the chip. */
  opportunityStage?: string | null;
  reasonCodes?: string[] | null;
  tradeTags?: string[] | null;

  /* Derived property-type axis for the "Exclude commercial" filter.
   * "unknown" when the permit gives no clear residential/commercial signal. */
  propertyType?: PropertyType;

  /* Phase AA-3 provenance. When source = 'parcel_synthesis' the card
   * surfaces a small "Pre-intent signal" indicator so the contractor
   * knows this is a parcel-derived lead, not a permit-backed one. */
  source?: string | null;

  /* Phase 1.3 DIY-vs-pro permit-applicant fields. Pulled directly from
   * `permits.applicant_name` + `permits.contractor_name` (migration
   * 00004 columns). Used by the ApplicantBadge component in the drawer
   * to render a "Homeowner-pulled / Pulled by ACME LLC / Spec" chip. */
  permitApplicantName?: string;
  permitContractorName?: string;
}

/* ── WCAG AA text colour on a brand tint (2026-08-06) ─────────────────────
 *
 * Henri paints small chips and the score disc as "brand hex text on a
 * 10-12% tint of the same brand hex". That reads as one colour family, but
 * it is two nearly-identical luminances. Measured on the shipped light
 * theme (`layout.tsx` ships `data-theme="light"`, `--card: #FFFFFF`):
 *
 *   score disc   #D4886A 2.55:1 · #D4A24A 2.15:1 · #4A7FC0 3.67:1
 *   stage chips  1.56:1 (stalled) … 3.23:1 (permit filed, no contractor)
 *
 * All are under the 4.5:1 AA floor that applies to text below 18.66px, and
 * every one of these is 10-12px.
 *
 * The brand rule keeps `#D4886A` (and the rest of the stage palette) as the
 * accent/surface colour, so only the glyph moves: the tint background, the
 * border and the dot stay on the raw hex, and just the text is pushed along
 * the lightness axis until it clears the floor. Channels scale
 * proportionally, so hue is preserved and each chip still reads as its
 * stage.
 *
 * `light-dark()` selects the pair per theme. The dark themes are therefore
 * unchanged — they already measured 4.19:1-8.43:1 and keep the raw hex
 * wherever it passes. A browser without `light-dark()` drops the
 * declaration and inherits the body colour, which is legible on both
 * surfaces.
 */

/** AA needs 4.5:1; the extra 0.1 is headroom for channel rounding. */
const AA_MIN_RATIO = 4.6;
/** `--card` in the light theme (globals.css). */
const LIGHT_SURFACE = "#FFFFFF";
/** `--card` in the `dusk` theme. Dusk is the LIGHTER of the two dark
 *  surfaces (`dark` is #1C1B18), so solving against it satisfies both. */
const DARK_SURFACE = "#231A0E";

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const h = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex([r, g, b]: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function relativeLuminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flatten `fg` at `alpha` over the opaque `base`. */
function composite(fg: RGB, base: RGB, alpha: number): RGB {
  return [
    fg[0] * alpha + base[0] * (1 - alpha),
    fg[1] * alpha + base[1] * (1 - alpha),
    fg[2] * alpha + base[2] * (1 - alpha),
  ];
}

/**
 * Smallest lightness shift of `hex` that clears `AA_MIN_RATIO` as text on
 * `hex` tinted at `alpha` over `surface`. Moves toward black on a light
 * surface and toward white on a dark one. Returns `hex` unchanged when it
 * already passes, so themes that were already compliant are untouched.
 */
export function aaTextOn(hex: string, alpha: number, surface: string): string {
  const fg = parseHex(hex);
  const base = parseHex(surface);
  if (!fg || !base) return hex;
  const bg = composite(fg, base, alpha).map(Math.round) as RGB;
  const towardWhite = relativeLuminance(base) < 0.5;
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const candidate = (
      towardWhite
        ? (fg.map((v) => v + (255 - v) * t) as RGB)
        : (fg.map((v) => v * (1 - t)) as RGB)
    ).map(Math.round) as RGB;
    if (contrastRatio(candidate, bg) >= AA_MIN_RATIO) return toHex(candidate);
  }
  return towardWhite ? "#FFFFFF" : "#000000";
}

const tintTextCache = new Map<string, string>();

/**
 * CSS `color` value for text drawn on `hex` tinted at `alpha` over the card
 * surface — a `light-dark()` pair so each theme gets its own AA-safe glyph
 * while the tint background stays on the raw brand hex.
 *
 * Memoised: there are only ~14 distinct (hex, alpha) pairs in the app, and
 * this is called per card in a virtualized list.
 */
export function tintTextColor(hex: string, alpha: number): string {
  const key = `${hex}|${alpha}`;
  const hit = tintTextCache.get(key);
  if (hit) return hit;
  const value = `light-dark(${aaTextOn(hex, alpha, LIGHT_SURFACE)}, ${aaTextOn(
    hex,
    alpha,
    DARK_SURFACE,
  )})`;
  tintTextCache.set(key, value);
  return value;
}

/** Alpha of the score disc's tint background on the Leads list. Must stay
 *  in step with the `color-mix()` percentages in `scoreColor` below. */
export const SCORE_TINT_ALPHA = 0.1;

/** Alpha of the stage chip's tint background — the `1A` suffix on the
 *  inline `backgroundColor` below (0x1A / 255). Shared with the Kanban
 *  card, which paints the identical chip. */
export const STAGE_TINT_ALPHA = 0x1a / 255;

/** Raw score-tier hexes. These mirror `--hot` / `--warm` / `--cool` in
 *  globals.css; the tint background below still resolves through the CSS
 *  vars, these literals exist only so the AA solver can do arithmetic on
 *  them (CSS vars aren't readable at render time). */
export function scoreHex(score: number): string {
  if (score >= 75) return "#D4886A"; // --hot
  if (score >= 50) return "#D4A24A"; // --warm
  return "#4A7FC0";                   // --cool
}

/* Score pill color — switched from hardcoded `bg-[rgba(...)]` literals
 * to `color-mix()` over the canonical `--hot / --warm / --cool` tokens.
 * If the brand palette ever shifts, the pill colour propagates from the
 * token definition instead of requiring a grep-and-replace. The 10%
 * opacity is the same visual result as the old rgba values.
 *
 * The `text-hot` / `text-warm` / `text-cool` classes were dropped from this
 * return on 2026-08-06: they rendered the numeral at 2.55 / 2.15 / 3.67:1.
 * The glyph colour now comes from `tintTextColor(scoreHex(score))` at the
 * call site, which measures 4.65 / 4.71 / 4.66:1 in light theme.
 *
 * Shape is kept as a circle (w-9 h-9 rounded-full) rather than routed
 * through the Badge primitive — Badge is pill-shaped, and the distinct
 * circular score dot is a deliberate visual anchor on each card. */
function scoreColor(score: number) {
  if (score >= 75) return "bg-[color-mix(in_srgb,var(--hot)_10%,transparent)]";
  if (score >= 50) return "bg-[color-mix(in_srgb,var(--warm)_10%,transparent)]";
  return "bg-[color-mix(in_srgb,var(--cool)_10%,transparent)]";
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
  /** Phase AA — true when this lead's id is in the contractor's
   *  `saved_leads` table. Renders a small bookmark indicator in the
   *  card header so saved leads are recognisable in the unfiltered
   *  list, not only when the "Saved only" pill is active. */
  isSaved?: boolean;
}

export function LeadCard({ lead, active, onClick, exclusivity: _exclusivity, disambiguate, isSaved }: LeadCardProps) {
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

  /* Module 22 — stage palette for the left-border tint + inline dot. When
   * a lead has been classified, the card carries a 3px coloured left
   * border that matches the chip + map pin colour for that stage so the
   * LeadsPanel becomes a visual histogram of intent at a glance. Pre-
   * backfill rows fall through to the original transparent/active styles. */
  const stagePalette = paletteFor(lead.opportunityStage);
  const inlineBorderStyle = active
    ? undefined
    : stagePalette
      ? { borderLeftColor: stagePalette.color }
      : undefined;

  return (
    <button
      onClick={onClick}
      /* Selectable-card semantics: the card acts as a toggle for "this
       * lead is the active one", so screen readers get the pressed
       * state alongside the visual active border. */
      aria-pressed={!!active}
      style={inlineBorderStyle}
      className={cn(
        "w-full text-left px-4 py-3 border-l-3 transition-colors",
        active
          ? "border-l-primary bg-primary-04"
          : stagePalette
            ? "hover:bg-bg-subtle"
            : "border-l-transparent hover:bg-bg-subtle"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* `title` exposes the full address on hover — the virtualized
           * list clamps every row to CARD_HEIGHT with overflow:hidden and
           * this line is `truncate`d, so long addresses are otherwise
           * unreadable. Minimal safe fix; no layout change. */}
          <p
            className="text-sm font-semibold text-foreground truncate"
            title={lead.fullAddress || lead.addr}
          >
            {/* Phase AA — saved indicator. Bookmark icon appears
                inline ahead of the address so the contractor can
                spot saved leads in the unfiltered list, not only
                when the "Saved only" pill is on. */}
            {isSaved && (
              <Bookmark
                className="inline-block h-3 w-3 text-primary mr-1 -mt-0.5 fill-current"
                aria-label="Saved"
              />
            )}
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
            {/* Phase AA-3 — pre-intent provenance badge. Only fires for
                leads synthesised from parcel data (no permit backing).
                Visually distinct from the stage chip so contractors
                instantly know "this is a soft signal, not a filed
                permit." Honest labeling — no fake "permit" framing on
                a parcel-derived lead. */}
            {lead.source === "parcel_synthesis" && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-tight bg-bg-subtle text-muted-foreground border border-border"
                title="Pre-intent signal from parcel data — no permit on file. The classifier surfaced this address based on property age, ownership, or recent transfer signals."
              >
                Pre-intent signal
              </span>
            )}
            {(lead.cascade || (lead.cascadeCount ?? 0) > 1) && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary-08 px-1.5 py-0.5 rounded">
                <span className="text-xs">&#9670;</span>{" "}
                {(lead.cascadeCount ?? 0) > 1
                  ? `${lead.cascadeCount} permits`
                  : "Cascade"}
              </span>
            )}
            {/* Module 22 — stage indicator chip. Same palette as the drawer
                IntentChip + map pin so the visual signal is consistent
                everywhere. Renders only when the classifier has stamped
                the row (unstamped rows fall back to the existing trade /
                cascade chips). */}
            {stagePalette && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-tight"
                style={{
                  backgroundColor: `${stagePalette.color}1A`,
                  // Tint, border and dot stay on the raw stage hex — only
                  // the label darkens, and only where the theme needs it.
                  color: tintTextColor(stagePalette.color, STAGE_TINT_ALPHA),
                  border: `1px solid ${stagePalette.color}66`,
                }}
                title={stagePalette.label}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: stagePalette.color }}
                />
                {stagePalette.label}
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
                  // Canonical urgency tokens (same --hot / --warm the score
                  // pill uses) rather than rogue hex literals.
                  backgroundColor: dot === "red" ? "var(--hot)" : "var(--warm)",
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
          style={{ color: tintTextColor(scoreHex(score), SCORE_TINT_ALPHA) }}
        >
          {score}
        </div>
      </div>
    </button>
  );
}
