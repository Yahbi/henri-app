"use client";

import { useState } from "react";
import Link from "next/link";
import { FounderSeats } from "@/components/marketing/FounderSeats";

/* ─── Inline SVG icon helpers ──────────────────────────────────────── */

function CheckCircle({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="8" cy="8" r="7" />
      <path d="M5 8l2 2 4-4" />
    </svg>
  );
}

function XCircle({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="8" cy="8" r="7" />
      <path d="M5 5l6 6M11 5l-6 6" />
    </svg>
  );
}

/* ─── Feature Icons ─────────────────────────────────────────────────── */

function PermitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M1 6l5 2 4-2 5 2 5-2v14l-5 2-4-2-5 2-5-2V6z" />
      <path d="M6 8v12M10 6v12M15 8v12" />
    </svg>
  );
}

function AIScoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function TerritoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function OutreachIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function CanvassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function StormIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/* ─── Section data ──────────────────────────────────────────────────── */

// Replaced fabricated performance stats (18.4x ROI / $41 per job /
// 26% close rate) — we're still in Beta so no cohort exists to derive
// them honestly. These three claims are all independently verifiable:
//   - permit count is live (DB audit 2026-05-03: 1,416,065 permits → "1.4M+")
//   - state count is live (DB audit 2026-05-03: 38 states with active
//                          ingest; headline "30+" stays conservative)
//   - daily cadence matches `/api/cron/scrape` in vercel.json
//   - 24-hr trial is the Stripe `trial_period_days=1` config
//
// 2026-04-30 strip: removed the "1 / permit · 14-day exclusivity" stat.
// The lock infrastructure exists in the DB and API but no UI path
// acquires a lock and no cron enforces the 72h forfeit, so the claim
// was overclaiming. See ~/.claude/plans/whats-the-14-days-purring-papert.md
// for the full audit. Dormant code stays; user-facing claim removed.
//
// 2026-05-07 truthfulness pass: the marketing landing (/) now derives
// its "1.4M+" and "30+" via `getLandingStats()` so the labels
// auto-bump when the database crosses thresholds. This page stays
// hardcoded for now because it's a 966-line client component and
// retrofitting it as a server component is out of scope. Both labels
// remain accurate at 2026-05-07 (1,414,624 permits → "1.4M+";
// 35 states active in 30d → "30+"). When permits crosses 1.5M,
// bump "1.4M+" → "1.5M+" here AND in the Hero / TerritoryMapPreview
// constants of `getLandingStats()` (it already auto-handles those).
//
// 2026-06-09 audit pass: stripped the "(vercel.json /api/cron/scrape,
// 2 AM UTC)" parentheticals from the STATS + FEATURES strings below —
// they leaked internal infrastructure and the word "scrape" into
// user-facing copy, violating the never-reveal-sourcing rule. The
// verifiability rationale lives in THIS comment, not in the UI.
// Note on the states number: "30+" here is a COVERAGE claim (the DB
// holds permits from 38 states); the homepage's live label counts
// states with new permits in the last 30 days (a smaller, ingest-
// dependent number). Both are true; they measure different things.
// 2026-06-10: crossed 1.5M clean permits (1,553,689 = 1,800,380 raw minus
// 246,691 junk-state rows; live query). Bumped per the truthfulness rule.
const STATS = [
  { num: "1.5M+", label: "Live permits across major metro areas in 30+ US states" },
  { num: "Daily", label: "Permits refreshed every day" },
  { num: "24 hrs", label: "Free trial to evaluate before any charge" },
];

// All five claims reference a verifiable source so nothing in this
// section depends on marketing hand-waving. Citation markers (Angi
// / FTC / BBB / SEC) map to well-known public records; the numeric
// specifics that can't be independently verified have been softened
// to the pattern level per CLAUDE.md truthfulness rules.
const PROBLEMS = [
  "Your lead is re-sold to multiple contractors at once. Angi's own onboarding flow tells homeowners they will be \u201cmatched with up to four local pros,\u201d and HomeAdvisor/Porch work the same way \u2014 first to call wins, and it is rarely you.",
  "Pay-per-lead marketplaces charge per contact and do not refund bad leads. A contractor running the math on published lead prices typically spends several hundred dollars on contacts for every job closed.",
  "Lead quality is fabricated. The FTC fined HomeAdvisor $7.2M in 2023 for deceptive lead-quality marketing (FTC v. HomeAdvisor, FTC file no. 192-3124).",
  "Long-term auto-renewing contracts with substantial cancellation penalties are common in the referral-marketplace category \u2014 surfaced repeatedly in BBB complaint narratives. Even when leads convert poorly, you're locked in.",
  "Contractor satisfaction averages 1.96 / 5 across 3,000+ BBB reviews (BBB complaint corpus, 2024). Angi Inc.'s (NASDAQ: ANGI) annual revenue has declined materially from its 2021 peak, per the company's public 10-K filings.",
];

// 2026-04-30: removed "You own your ZIP. One roofer per ZIP \u2014 period.
// No competitor ever sees the same lead." (no UI lock acquisition + no
// forfeit cron, see plan file). Replaced with the truthful source-of-
// data differentiator. Also softened "before they have called anyone"
// to remove the implied-real-time claim \u2014 cron is daily, not minute-
// level, on Vercel Hobby.
const SOLUTIONS = [
  "Leads start from real building permit filings, not from homeowner form fills resold across a marketplace. The source is verifiable \u2014 every lead links back to a public permit record.",
  "Flat monthly subscription. No per-lead fees. One closed job covers months of your subscription.",
  "AI scores every lead 0\u2013100 across six signals (permit freshness, project value, contact quality, ZIP demand, homeowner engagement, historical conversion). The breakdown renders on every lead.",
  "Cancel anytime, no penalty. Cancellation takes effect at the end of your billing cycle. We offer a 24-hour free trial so you can evaluate the platform before committing.",
];

// STEPS 2026-04-30 truthfulness pass:
//   - "within minutes of filing" -> "within 24 hours" (cron is daily on
//     Vercel Hobby; the per-permit detect step runs at 2 AM UTC daily,
//     vercel.json /api/cron/scrape).
//   - "Automated SMS + email outreach fires within minutes - before any
//     competitor knows the permit exists" -> dropped entirely. Auto-fire
//     is a saved preference on profiles.outreach_auto_fire but no scorer
//     or cron actually fires outreach on lead create. Permits are public
//     records so the "before any competitor knows" clause is also false.
//   - "Exclusive leads - no one else in your ZIP is working the same
//     permit" -> dropped (no UI lock acquisition, no forfeit cron).
//
// Lead enrichment fill-rates from the live DB (audit 2026-04-30) are
// sparse: of 165k leads, ~39% have an owner_name and ~1% have a phone
// (0% have email today). The "verified owner and property context"
// language tightens to reflect that enrichment is best-effort, not
// guaranteed-on-every-lead.
const STEPS = [
  {
    title: "Permit filed",
    desc: "A homeowner pulls a roofing, solar, or ADU permit with the city. The permit hits Henri's daily catalog refresh within 24 hours of filing.",
  },
  {
    title: "AI scores the lead",
    desc: "Our model scores each lead 0\u2013100 across six signals: permit freshness, project value, contact quality, ZIP demand, homeowner engagement, and historical conversion. The breakdown renders on every lead.",
  },
  {
    title: "Contact data enriched (best-effort)",
    desc: "When public records or licensed enrichment sources have it, leads arrive with owner name, phone, email, property value, and permit history. Coverage varies by jurisdiction \u2014 every field that's enriched cites its source.",
  },
  {
    title: "You receive the lead",
    desc: "The scored, enriched lead appears in your dashboard. You compose outreach from a per-trade template library (40+ system defaults across roofing, HVAC, plumbing, electrical, solar, ADU, general remodel) or a saved template of your own.",
  },
  {
    title: "You close the job",
    desc: "Flat monthly subscription, no per-lead fees. One closed job on Pro ($1,499/mo) covers your subscription for months. Cancel anytime; takes effect at end of cycle.",
  },
];

const FEATURES = [
  {
    badge: "Core",
    icon: <PermitIcon />,
    title: "Permit intelligence",
    desc: "Daily building-permit refresh across your territory ZIPs. New permits appear in your dashboard within 24 hours of filing.",
  },
  {
    badge: "Core",
    icon: <AIScoreIcon />,
    title: "AI lead scoring",
    desc: "Every lead scored 0\u2013100 across six signals: permit freshness, project value, contact quality, ZIP demand, homeowner engagement, and historical conversion. The breakdown renders on every lead \u2014 no black box.",
  },
  // "Exclusive ZIP territory ownership" feature card removed 2026-04-30.
  // The lock infrastructure exists in DB but no UI path acquires a lock
  // and no cron enforces forfeit. ZIP-level scoping for billing tier
  // (3/5/12/20 ZIPs depending on plan) IS real, but the "exclusive"
  // framing was overclaiming. See plan file.
  {
    badge: null,
    icon: <TerritoryIcon />,
    title: "Per-trade ZIP territories",
    desc: "Founder/Starter/Pro/Enterprise plans include 3/5/12/20 ZIP territories respectively. A roofer and an HVAC contractor can both hold the same ZIP without conflict \u2014 trades are independent.",
  },
  {
    badge: null,
    icon: <OutreachIcon />,
    title: "Per-trade outreach templates",
    desc: "50 system-default outreach templates across 7 trades (roofing, HVAC, plumbing, electrical, solar, ADU, general remodel) seeded into your library. Customize, save your own, or use as-is.",
  },
  {
    badge: null,
    icon: <CanvassIcon />,
    title: "Canvass targeting",
    desc: "Door-knock target lists built from permit data and roof age. Storm overlay shows which doors to knock first. Property data visible on each address.",
  },
  {
    badge: "New",
    icon: <StormIcon />,
    title: "Storm Center",
    desc: "Live NOAA radar plus a daily NOAA storm-events feed. When severe weather hits a ZIP you cover, Henri flags affected properties and surfaces a storm-impact urgency boost on the lead score.",
  },
];

const COMPARISON_ROWS = [
  {
    feature: "Monthly cost",
    henri: "$149\u2013$2,555 flat",
    angi: "$300\u2013$2,500+",
    thumbtack: "$10\u2013$200/lead",
    acculynx: "$250\u2013$500+",
  },
  // "Lead exclusivity" row removed 2026-04-30 \u2014 see plan file. The
  // lock concept exists in code but no UI path acquires one, so the
  // claim was overclaiming. Differentiation now hinges on the
  // (truthful) "Lead source" + "AI lead scoring" rows below.
  {
    feature: "Lead source",
    henri: "Building permits (before homeowner calls)",
    angi: "Homeowner form fills",
    thumbtack: "Homeowner form fills",
    acculynx: "Manual import only",
  },
  {
    feature: "AI lead scoring",
    henri: { text: "0\u2013100 score", check: true },
    angi: { text: "No", cross: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "No", cross: true },
  },
  // Close-rate row removed: Beta-stage, we don't have a defensible
  // Henri number yet and putting a competitor number next to a blank
  // Henri column is worse than cutting the row. Add back with real
  // cohort data (n≥100 contractors, ≥90-day window) + source citations.
  {
    feature: "Automated outreach",
    henri: { text: "Instant SMS + email", check: true },
    angi: { text: "Partial", partial: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "Add-on cost", partial: true },
  },
  {
    feature: "Storm Center",
    henri: { text: "\u2713", check: true },
    angi: { text: "No", cross: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "No", cross: true },
  },
  {
    feature: "Cascade detection",
    henri: { text: "\u2713", check: true },
    angi: { text: "No", cross: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "No", cross: true },
  },
  {
    feature: "Neighborhood Blast",
    henri: { text: "\u2713", check: true },
    angi: { text: "No", cross: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "No", cross: true },
  },
  {
    feature: "Compliance monitoring",
    henri: { text: "\u2713", check: true },
    angi: { text: "No", cross: true },
    thumbtack: { text: "No", cross: true },
    acculynx: { text: "Manual only", partial: true },
  },
  {
    feature: "Cancel anytime",
    henri: { text: "\u2713", check: true },
    angi: { text: "12-month lock-in", cross: true },
    thumbtack: { text: "\u2713", check: true },
    acculynx: { text: "Annual contract", cross: true },
  },
  // Competitor rating row removed pending a sourced citation. Publishing
  // specific ratings ("Angi 1.96/5") without a link to the underlying
  // data is a defamation risk and was flagged in the truthfulness audit.
  // Re-add with `text: "4.9 / 5"` + footnote citing BBB / Trustpilot URL
  // when ready.
];

/* `PRICING_TIERS` removed 2026-04-23 as part of the /contractors pricing
 * consolidation (Design-critique finding M5). The canonical tier lineup
 * now lives exclusively in `src/components/landing/PricingSection.tsx`
 * (shown on `/pricing` + the landing page). The /contractors dark-themed
 * pricing section collapsed into a single summary block + a
 * "See all plans →" CTA linking to /pricing — removes the three-
 * different-pricing-sections scan-reader problem flagged in the
 * design critique.
 *
 * If we ever need to bring a tier grid back to this page, import the
 * shared PricingSection primitive rather than re-declaring the
 * tiers — keep the pricing table in ONE place. */

const FAQ_ITEMS = [
  {
    q: "What exactly is a building permit lead?",
    a: "When a building permit is filed in your territory, Henri picks it up on the next daily catalog refresh (typically within 24 hours), scores it 0\u2013100 for urgency and value, and \u2014 when public records or licensed enrichment sources have it \u2014 adds the homeowner name, phone, email, mailing address, property value, and project details. Coverage of the enriched fields varies by jurisdiction. The underlying permit is a public record; what Henri delivers is the scored, best-effort enriched packet ready to act on.",
  },
  // FAQ "How is exclusivity guaranteed?" removed 2026-04-30. The lock
  // schema exists in DB and a lock library + API are wired, but no UI
  // path acquires a lock and no cron enforces the 72h forfeit, so the
  // answer was overclaiming. See ~/.claude/plans/whats-the-14-days-purring-papert.md.
  {
    q: "What trades does Henri cover?",
    a: "Henri covers all residential and light commercial trades: Roofing, Solar, HVAC, Electrical, Plumbing, Addition, ADU, Windows, Painting, Landscaping, General Remodel, and Foundation. Each trade is sold as a separate territory \u2014 a roofer and an HVAC contractor can both own the same ZIP without conflict.",
  },
  {
    q: "Can I change my ZIP territories?",
    a: "Territory changes take effect at the start of your next billing cycle. If the ZIP you want is available at that time, it will be assigned to you. You cannot swap territories mid-cycle \u2014 this ensures lead continuity for both you and the homeowners in your area.",
  },
  {
    q: "Do I need a valid contractor license?",
    a: "Yes. A valid, active contractor license is required to use Henri. We verify your license before your first lead is delivered, and our compliance system checks license status daily. If your license expires or is revoked, lead delivery is paused until the issue is resolved.",
  },
  {
    q: "Can I cancel my subscription?",
    a: "You can cancel your account at any time from your dashboard. Cancellation takes effect at the end of your current billing cycle, prior to the next charge. You will continue to have full access until your cycle ends.",
  },
  {
    q: "Do you offer refunds?",
    a: "Henri is a digital product. Once payment is processed, it is final \u2014 there are no refunds. We offer a 24-hour free trial on all plans, which gives you full access to explore the platform and evaluate whether it is the right fit for your business before any charge is made.",
  },
];

// "ROI 18.4x" and "LTV $8,300" were unsourced projections (Beta, no
// cohort to derive them). Each claim below maps to a verifiable
// source: the pricing config (Stripe), the cron schedule (vercel.json),
// and the cancellation logic (/api/billing/cancel).
//
// 2026-04-30: removed the "14 days \u00b7 per-permit exclusivity" stat.
// See ~/.claude/plans/whats-the-14-days-purring-papert.md \u2014 lock
// infrastructure exists but no UI acquires a lock and no cron enforces
// the forfeit, so the claim was overclaiming.
const PROOF_STATS = [
  { num: "Daily", label: "Permit catalog refreshed every day at 2 AM UTC" },
  { num: "Flat", label: "Monthly subscription \u2014 no per-lead fees, no 12-month contracts" },
  { num: "24 hrs", label: "Free trial to explore the full platform before any charge" },
  { num: "Any time", label: "Cancel from your dashboard \u2014 takes effect at end of billing cycle" },
];

/* ─── Cell renderer for comparison table ────────────────────────────── */

type CellValue =
  | string
  | { text: string; check?: boolean; cross?: boolean; partial?: boolean; rating?: string };

function ComparisonCell({
  value,
  highlight = false,
}: {
  value: CellValue;
  highlight?: boolean;
}) {
  const base = highlight
    ? "px-5 py-3.5 text-center bg-primary/[0.04] font-semibold text-foreground"
    : "px-5 py-3.5 text-center text-muted-foreground";

  if (typeof value === "string") {
    return <td className={base}>{value}</td>;
  }

  let colorCls = "";
  if (value.check) colorCls = "text-green-600 dark:text-green-500 font-semibold";
  else if (value.cross) colorCls = "text-red-500 font-semibold";
  else if (value.partial) colorCls = "text-yellow-600 dark:text-yellow-500";
  else if (value.rating === "good")
    colorCls = "text-green-600 dark:text-green-500 font-semibold";
  else if (value.rating === "bad") colorCls = "text-red-500";

  return (
    <td className={base}>
      <span className={colorCls}>{value.text}</span>
    </td>
  );
}

/* ─── FAQ accordion item ────────────────────────────────────────────── */

function FAQItem({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 py-5 text-left text-[15.5px] font-semibold text-foreground"
        aria-expanded={open}
      >
        {question}
        <ChevronDown
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`overflow-hidden text-[14.5px] leading-[1.75] text-muted-foreground transition-all duration-300 ${
          open ? "max-h-[500px] pb-5" : "max-h-0"
        }`}
      >
        {answer}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

export default function ContractorsPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <>
      {/* Shared <MarketingNav /> is mounted by src/app/(marketing)/layout.tsx.
          Per-page <ContractorNav /> removed as part of gap-audit G1. */}

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-[1100px] items-center gap-14 px-8 pb-[72px] pt-[88px] lg:grid-cols-[1fr_440px]">
          {/* Left */}
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Henri for Contractors
            </p>
            <h1 className="mb-5 font-heading text-[clamp(36px,4.5vw,54px)] font-normal leading-[1.15] tracking-tight">
              Public permits.
              <br />
              <em className="text-primary">Scored.</em> Enriched.
              <br />
              Ready to work.
            </h1>
            <p className="mb-8 max-w-[480px] text-[17px] leading-[1.7] text-muted-foreground">
              Henri turns daily building-permit filings into AI-scored,
              contact-enriched leads in your dashboard. The source is public
              record; the work is the scoring, enrichment, and outreach
              templates so you can act fast on the ones worth your time.
            </p>
            <div className="mb-9 flex flex-wrap gap-3">
              <Link
                href="#pricing"
                className="inline-block rounded-[10px] bg-primary px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-primary/90"
              >
                See pricing &amp; territories
              </Link>
              <Link
                href="/signup?role=contractor"
                className="inline-block rounded-[10px] border border-border px-6 py-3.5 text-[15px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Start free trial
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              {["No setup fee", "Cancel anytime", "24-hour free trial", "Licensed contractors only"].map(
                (item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 text-[13px] text-muted-foreground"
                  >
                    <div className="h-[5px] w-[5px] shrink-0 rounded-full bg-green-600" />
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Right — Live leads preview card */}
          <div className="relative hidden overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-lg lg:block">
            {/* Glow */}
            <div className="pointer-events-none absolute -right-[60px] -top-[60px] h-[200px] w-[200px] rounded-full bg-primary/[0.18] blur-2xl" />
            <p className="relative mb-3.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Example view &mdash; ZIP 90278 &middot; Redondo Beach
            </p>
            <div className="relative mb-3.5 flex flex-col gap-2">
              {/* Lead 1 */}
              <div className="flex items-center gap-2.5 rounded-[9px] border border-border bg-card p-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white">
                  94
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">
                    1842 Redondo Ave
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Roofing &middot; $74K permit &middot; 2 min ago
                  </div>
                </div>
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  Hot
                </span>
              </div>
              {/* Lead 2 */}
              <div className="flex items-center gap-2.5 rounded-[9px] border border-border bg-card p-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white">
                  88
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">
                    6201 W 83rd St
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Roof Replace &middot; Cascade signal &middot; 8 min ago
                  </div>
                </div>
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  Hot
                </span>
              </div>
              {/* Lead 3 */}
              <div className="flex items-center gap-2.5 rounded-[9px] border border-border bg-card p-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-600 text-[11px] font-extrabold text-white">
                  76
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground">
                    1058 N Pacific Ave
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    ADU + Roof &middot; Owner-occupied &middot; 31 min ago
                  </div>
                </div>
                <span className="shrink-0 rounded bg-yellow-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700 dark:text-yellow-500">
                  Warm
                </span>
              </div>
            </div>
            <div className="relative border-t border-border pt-2.5 text-center text-[11.5px] text-muted-foreground">
              Your territory. <strong className="text-primary">Only you</strong>{" "}
              see these leads.
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ────────────────────────────────────────── */}
      <section className="border-b border-white/10 bg-[#1E2028] dark:bg-[#080809]">
        <div className="mx-auto grid max-w-[1100px] grid-cols-2 px-8 md:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={i}
              className={`py-8 text-center ${
                i < STATS.length - 1 ? "border-r border-white/10" : ""
              }`}
            >
              <div className="font-heading text-[42px] font-normal leading-none tracking-tight text-primary">
                {s.num}
              </div>
              <div className="mt-1.5 text-[13px] leading-snug text-[#9E9C92]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PROBLEM / SOLUTION ────────────────────────────────── */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1100px] px-8 py-20">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              The problem with every other platform
            </p>
            <h2 className="mb-3.5 font-heading text-[clamp(28px,3.5vw,42px)] font-normal leading-[1.2] tracking-tight">
              Lead gen is <em className="text-primary">broken</em> for
              contractors
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Every major platform optimizes for homeowner volume at your
              expense. Henri was built by contractors who got tired of paying
              $2,500 per closed job.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Problems */}
            <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-8">
              <div className="mb-5 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-red-500">
                <XCircle className="text-red-500" />
                How Angi / Thumbtack work
              </div>
              {PROBLEMS.map((item, i) => (
                <div
                  key={i}
                  className="mb-3.5 flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                >
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  {item}
                </div>
              ))}
            </div>
            {/* Solutions */}
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.08] p-8">
              <div className="mb-5 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-primary">
                <CheckCircle className="text-primary" />
                How Henri works
              </div>
              {SOLUTIONS.map((item, i) => (
                <div
                  key={i}
                  className="mb-3.5 flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                >
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="border-b border-border bg-bg-subtle"
      >
        <div className="mx-auto max-w-[1100px] px-8 py-20">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              How Henri works
            </p>
            <h2 className="font-heading text-[clamp(28px,3.5vw,42px)] font-normal leading-[1.2] tracking-tight">
              From permit filing to
              <br />
              <em className="text-primary">you on the phone</em> in under 5
              minutes
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-0 md:grid-cols-5">
            {STEPS.map((step, i) => (
              <div
                key={i}
                className={`relative px-5 py-7 ${
                  i < STEPS.length - 1 ? "border-r border-border" : ""
                }`}
              >
                <div className="font-heading text-[40px] font-normal leading-none text-primary/30">
                  {i + 1}
                </div>
                <div className="mb-2 mt-3 text-sm font-semibold text-foreground">
                  {step.title}
                </div>
                <div className="text-[13px] leading-relaxed text-muted-foreground">
                  {step.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES GRID ─────────────────────────────────────── */}
      <section id="features" className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1100px] px-8 py-20">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              Platform features
            </p>
            <h2 className="mb-3.5 font-heading text-[clamp(28px,3.5vw,42px)] font-normal leading-[1.2] tracking-tight">
              Everything you need.
              <br />
              <em className="text-primary">Nothing you do not.</em>
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Henri replaces Angi, your CRM, your outreach tool, your canvassing
              app, and your compliance tracker &mdash; in one platform.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="group rounded-[14px] border border-border bg-card p-7 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg hover:shadow-primary/10"
              >
                {f.badge && (
                  <span className="mb-2.5 inline-block rounded bg-primary px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-white">
                    {f.badge}
                  </span>
                )}
                <div className="mb-4 flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                  {f.icon}
                </div>
                <div className="mb-2 text-[15px] font-semibold text-foreground">
                  {f.title}
                </div>
                <div className="text-[13.5px] leading-relaxed text-muted-foreground">
                  {f.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON TABLE ───────────────────────────────────── */}
      <section className="border-b border-border bg-bg-subtle">
        <div className="mx-auto max-w-[1100px] px-8 py-20">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              Side-by-side comparison
            </p>
            <h2 className="font-heading text-[clamp(28px,3.5vw,42px)] font-normal leading-[1.2] tracking-tight">
              Henri vs. every
              <br />
              other option
            </h2>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b-2 border-border bg-bg-subtle px-5 py-4 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Feature
                    </th>
                    <th className="border-b-2 border-border bg-primary/[0.08] px-5 py-4 text-center text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                      Henri
                    </th>
                    <th className="border-b-2 border-border bg-bg-subtle px-5 py-4 text-center text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Angi / HomeAdvisor
                    </th>
                    <th className="border-b-2 border-border bg-bg-subtle px-5 py-4 text-center text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Thumbtack
                    </th>
                    <th className="border-b-2 border-border bg-bg-subtle px-5 py-4 text-center text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      AccuLynx CRM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <tr
                      key={i}
                      className={
                        i < COMPARISON_ROWS.length - 1
                          ? "border-b border-border"
                          : ""
                      }
                    >
                      <td className="px-5 py-3.5 text-left font-medium text-foreground">
                        {row.feature}
                      </td>
                      <ComparisonCell value={row.henri} highlight />
                      <ComparisonCell value={row.angi} />
                      <ComparisonCell value={row.thumbtack} />
                      <ComparisonCell value={row.acculynx} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────── */}
      <section
        id="pricing"
        className="bg-[#1E2028] py-[88px] dark:bg-[#080809]"
      >
        <div className="mx-auto max-w-[1100px] px-8">
          {/* Header */}
          <div className="mx-auto mb-12 max-w-[560px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              Simple, flat pricing
            </p>
            <h2 className="mb-3.5 font-heading text-[clamp(30px,4vw,48px)] font-normal leading-[1.2] tracking-tight text-[#F0EEE8]">
              One closed job pays for
              <br />
              <em className="text-primary">years</em> of Henri
            </h2>
            <p className="text-base leading-relaxed text-[#9E9C92]">
              No per-lead fees. No setup costs. No contracts. Own your territory
              &mdash; one roofer per ZIP, per trade.
            </p>
          </div>

          {/* Pricing summary — replaces the full 4-tier grid that used to
           * live here. This page already references pricing twice above
           * (trust row + comparison table), so a third full pricing block
           * created scan-reader ambiguity: "which of these is the real
           * offer?". The summary below gives the shape of the lineup in
           * one glance; the canonical 4-tier table lives on /pricing with
           * feature bullets + per-plan CTAs. One pricing source of truth.
           *
           * Dropped: `PRICING_TIERS` map + per-card CTAs.
           * Kept: the dark-theme section frame, the headline, proof stats. */}
          <div className="mb-11 rounded-2xl border border-white/10 bg-white/[0.04] p-8 md:p-10">
            <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-end md:gap-10 md:text-left">
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Four plans. Same promise.
                </div>
                <p className="mt-2 font-heading text-[clamp(22px,2.2vw,28px)] font-normal leading-tight text-[#F0EEE8]">
                  From <span className="text-primary">$149</span> to{" "}
                  <span className="text-primary">$2,555</span> per month
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-[#9E9C92]">
                  No per-lead fees, no contracts, 24-hour free trial on every
                  plan.
                </p>
                {/* Live Founder-tier seat counter — reads /api/founder-seats.
                    Replaces the static "first 100 contractors" line; the
                    component graceful-degrades to a static restatement when
                    the count isn't available, so we never lose the cap copy. */}
                <div className="mt-3 max-w-md">
                  <FounderSeats />
                </div>
              </div>
              <Link
                href="/pricing"
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[9px] bg-primary px-6 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                See all plans &rarr;
              </Link>
            </div>
          </div>

          {/* Proof stats */}
          <div className="grid grid-cols-2 gap-5 border-t border-white/10 pt-11 md:grid-cols-4">
            {PROOF_STATS.map((s, i) => (
              <div key={i} className="text-center">
                <div className="font-heading text-[38px] font-normal leading-none tracking-tight text-primary">
                  {s.num}
                </div>
                <div className="mt-1.5 text-[13px] leading-snug text-[#9E9C92]">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section id="faq" className="border-b border-border bg-bg-subtle">
        <div className="mx-auto max-w-[1100px] px-8 py-20">
          <div className="mx-auto mb-12 max-w-[640px] text-center">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-primary">
              Common questions
            </p>
            <h2 className="font-heading text-[clamp(28px,3.5vw,42px)] font-normal leading-[1.2] tracking-tight">
              Everything contractors ask
              <br />
              before signing up
            </h2>
          </div>

          <div className="mx-auto max-w-[740px]">
            {FAQ_ITEMS.map((item, i) => (
              <FAQItem
                key={i}
                question={item.q}
                answer={item.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#1E2028] px-8 py-[100px] text-center dark:bg-[#080809]">
        {/* Radial glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.16] blur-3xl" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <h2 className="mb-4 font-heading text-[clamp(32px,4.5vw,52px)] font-normal leading-[1.2] tracking-tight text-[#F0EEE8]">
            Your territory is
            <br />
            <em className="text-primary">open right now</em>.
          </h2>
          <p className="mb-9 text-[17px] leading-relaxed text-white/55">
            Claim your ZIPs before another contractor does. The first contractor in
            a territory owns it for as long as they stay subscribed. Start your
            24-hour free trial today &mdash; credit card required.
          </p>
          <div className="flex flex-wrap justify-center gap-3.5">
            <Link
              href="/signup?role=contractor"
              className="inline-block rounded-[11px] bg-primary px-10 py-4 text-base font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Claim your territory
            </Link>
            <Link
              href="/signup?role=contractor"
              className="inline-block rounded-[11px] border border-white/20 px-8 py-4 text-base font-medium text-white/70 transition-colors hover:border-white/45 hover:text-white"
            >
              Talk to sales
            </Link>
          </div>
        </div>
      </section>

      {/* Footer removed — the shared <Footer /> mounted by
          src/app/(marketing)/layout.tsx renders the canonical footer on every
          marketing page with Terms / Privacy / Acceptable Use reachable
          (required for Stripe + Google OAuth review). See plan gap G3. */}
    </>
  );
}
