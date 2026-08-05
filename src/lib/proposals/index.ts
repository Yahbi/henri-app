/**
 * Predictive proposal generator (extracted from `LeadDetailDrawer.tsx`
 * 2026-04-28 audit priority #9).
 *
 * Pure function — no I/O, no React. Given a lead, returns a proposal
 * object that the lead-detail drawer renders inline. Trade-aware: uses
 * the lead's trade + permit description + age + value to pick a
 * pre-written script that the contractor can use as their opening hook.
 *
 * Why extracted:
 *   `LeadDetailDrawer.tsx` was 1,116 LOC. Pulling out the 130-LOC
 *   proposal builder, the per-trade copy table, and the urgency rules
 *   reduces the drawer to <1,000 LOC and makes the proposal logic
 *   independently testable. Wedge bullet #2 (transparent confidence) +
 *   #4 (permit-specific outreach) are both partially served by these
 *   strings, so they're worth their own home.
 *
 * Wedge bullet #4 ("outreach is permit-specific"): the per-trade
 * proposals reference actual permit attributes (description tokens,
 * age, value) — never generic templates. If you add a new trade, the
 * pattern holds: condition on `desc.includes(...)` to distinguish
 * variants.
 *
 * Pure function makes this trivially testable; tests live at
 * `src/lib/proposals/__tests__/index.test.ts`.
 */

/** Lead shape the proposal builder reads. Narrowed to the fields it
 *  actually consumes so the lib doesn't grow a transitive type
 *  dependency on the full LeadData. */
export interface ProposalLeadInput {
  trade?: string | null;
  type?: string | null;
  permitAge?: number | null;
  value?: string | null;
  permitDescription?: string | null;
}

export interface Proposal {
  headline: string;
  insight: string;
  urgency: "high" | "medium" | "low";
  actions: string[];
  window: string;
  /** Formatted dollar-range string when the permit value is parseable. */
  estimatedRevenue: string | null;
}

/* ── Per-trade proposal copy ─────────────────────────────────────────
 *
 * Conditional on permit-description tokens so a single trade can have
 * variant scripts (e.g. roofing replacement vs. roofing repair). The
 * description-token check is a defensive `desc.includes(...)`; we
 * normalize to lowercase before lookup. */

interface TradeProposal {
  headline: string;
  insight: string;
  actions: string[];
}

const TRADE_PROPOSALS: Record<string, (desc: string) => TradeProposal> = {
  roofing: (desc) => ({
    headline: "Roof project — high-conversion opportunity",
    insight: desc.includes("replacement")
      ? "Full roof replacement permits show concentrated buying intent — the homeowner is past the comparison phase and actively sourcing bids. Reach out within 72 hours while attention is highest."
      : "Roof repair permits often expand in scope once inspection reveals additional damage. Offer a free inspection to uncover the full opportunity.",
    actions: [
      "Call within 24 hours to schedule a free estimate",
      "Prepare material cost comparison (shingle vs. tile vs. metal)",
      "Mention manufacturer warranty options to differentiate your bid",
    ],
  }),
  hvac: (desc) => ({
    headline: "HVAC system permit — seasonal urgency",
    insight: desc.includes("replacement")
      ? "System replacements are time-sensitive. The homeowner is without full heating/cooling and will choose fast. Lead with availability and same-week install."
      : "HVAC work often leads to duct replacement, insulation, or thermostat upgrades. Offer a bundled package to increase ticket size.",
    actions: [
      "Emphasize quick turnaround and available install dates",
      "Prepare energy efficiency comparison for upsell",
      "Offer financing options for systems over $8K",
    ],
  }),
  plumbing: (desc) => ({
    headline: "Plumbing permit — likely urgent need",
    insight:
      desc.includes("sewer") || desc.includes("repipe")
        // Truthfulness (audit 2026-08-04): "close at high rates" was an
        // unmeasured conversion claim. Henri has never computed a per-trade
        // close rate — `historical_conversion` is a per-ZIP/per-trade scoring
        // signal, not an observed win rate. Replaced with what the permit
        // itself proves: the scope is defined and permitted.
        ? "Whole-house plumbing work signals a committed homeowner — the scope is already defined and permitted, so the open question is which contractor, not whether to build."
        : "Plumbing repairs often indicate an aging home with upcoming renovation needs. Position yourself for the larger project pipeline.",
    actions: [
      "Respond within 24 hours — plumbing issues are urgent",
      "Offer a comprehensive inspection to identify other issues",
      "Provide a detailed estimate with material options",
    ],
  }),
  electrical: (desc) => ({
    headline: "Electrical permit — modernization opportunity",
    insight:
      desc.includes("panel") || desc.includes("200")
        ? "Panel upgrades are often prerequisites for solar, EV chargers, or renovation. Ask about their broader plans to capture adjacent work."
        : "Electrical permits for rewiring signal a property in active renovation. There may be opportunities for additional trades.",
    actions: [
      "Ask about plans for solar, EV charging, or home automation",
      "Provide a safety inspection to identify code compliance issues",
      "Offer a package deal for panel + related electrical upgrades",
    ],
  }),
  solar: () => ({
    headline: "Solar installation — high-value, high-intent",
    // Truthfulness (audit 2026-08-04): this string shipped
    // "These leads close at 40%+ when contacted within 48 hours."
    // Henri has never measured a per-trade close rate; the number was
    // invented and contradicted the scorer's own documented 18% national
    // baseline (model.ts NATIONAL_BASELINE). Same class as the already-
    // removed "18.4x ROI / 26% close rate" marketing stats
    // (src/app/(marketing)/contractors/page.tsx). Replaced with
    // qualitative guidance that needs no cohort to defend.
    insight:
      "Solar permit holders have already committed to the project and are comparing installers. Focus on timeline, warranty, and monitoring — speed of response is the main differentiator at this stage.",
    actions: [
      "Lead with production estimates specific to their roof orientation",
      "Highlight battery storage add-on for increased value",
      "Provide utility rate analysis showing ROI timeline",
    ],
  }),
  adu: () => ({
    headline: "ADU construction — major project opportunity",
    // Truthfulness (audit 2026-08-04): dropped the hardcoded "($80K-$200K+)"
    // band. Henri has a real `cost_benchmarks` table (migration 00016) but
    // this string never read from it, so the range was an unsourced literal.
    // The drawer already shows the permit's own declared value directly
    // above this line — that number IS provable, this one wasn't.
    insight:
      "Accessory dwelling units are high-value, multi-trade projects. The permit holder needs GC coordination across foundation, framing, plumbing, electrical, and finishes.",
    actions: [
      "Offer a comprehensive build package or GC services",
      "Provide a detailed timeline with milestones",
      "Discuss financing options — many ADU builders use construction loans",
    ],
  }),
  "general remodel": (desc) => ({
    headline: "Renovation project — multi-trade potential",
    // Truthfulness (audit 2026-08-04): dropped the hardcoded
    // "average $35K-$75K" — an unsourced literal, not a query result.
    insight: desc.includes("kitchen")
      ? "Kitchen remodels are multi-trade projects that often expand in scope once demo starts. Position as a full-service renovation partner."
      : desc.includes("bathroom")
        ? "Bathroom remodels are high-margin projects with quick turnaround. Offer design-build to simplify the process for the homeowner."
        : "Renovation permits indicate an active property improvement cycle. Capture the full scope of work including trades the owner hasn't considered yet.",
    actions: [
      "Schedule an in-home consultation to understand the full vision",
      "Prepare a portfolio of similar completed projects",
      "Offer design assistance to increase project scope and value",
    ],
  }),
};

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Normalize the caller's `permitAge` into a usable number of days, or
 * `null` when we genuinely don't know.
 *
 * Audit 2026-08-04: `generateProposal` used to do `lead.permitAge ?? 0`,
 * which turned "we have no filing date" into "filed today" — the single
 * most urgent value in the whole model. That produced an "Act Now" badge
 * and a "48 hours — first-mover advantage" competitive window on leads
 * whose date we don't have, in the same drawer that (correctly) hides the
 * "Filed" row because it detects the date is unknown
 * (LeadDetailDrawer effectiveAgeDays guard, LeadCard permitAge guard).
 * Unknown must stay unknown all the way through the proposal.
 */
function normalizeAge(age: number | null | undefined): number | null {
  if (age == null) return null;
  if (!Number.isFinite(age) || age < 0) return null;
  return age;
}

function urgencyFromAge(age: number | null): Proposal["urgency"] {
  // Unknown age is the LEAST urgent thing we can say honestly — never the
  // most. It is not evidence of freshness.
  if (age == null) return "low";
  if (age <= 3) return "high";
  if (age <= 10) return "medium";
  return "low";
}

function windowFromAge(age: number | null): string {
  if (age == null) return "Permit date unknown — verify the filing date before outreach";
  if (age <= 2) return "48 hours — first-mover advantage";
  if (age <= 7) return `${7 - age} days before competitive saturation`;
  return "Follow up promptly — other contractors may have reached out";
}

/* ── Contract-value anchor ───────────────────────────────────────────
 *
 * The band below is a DISCLOSED share of the permit's own declared value,
 * not a measured margin or close rate. The rendered string always names
 * the percentage and the permit value it was derived from, so a
 * contractor can reproduce the arithmetic. That is the difference
 * between an anchor and a fabricated metric.
 *
 * Audit 2026-08-04 fixed two defects here:
 *   1. A 1000x unit bug. `parseFloat("$2.5M".replace(/[$K,M]/g,""))` is
 *      2.5, but the "M" branch interpolated it into a template that
 *      hardcoded "K" — so a $2.5M permit rendered "$0K - $1K contractor
 *      revenue", and 1,957 live leads in the $1M-$10M band collapsed to
 *      "$0K - $0K". Values are now converted to absolute dollars once
 *      and re-formatted at whatever magnitude they land in.
 *   2. Two undisclosed and mutually contradictory multiplier pairs
 *      (0.15-0.25 for $M permits, 0.40-0.70 for $K permits). One
 *      disclosed band now applies at every magnitude.
 */
const PERMIT_VALUE_SHARE_LOW = 0.4;
const PERMIT_VALUE_SHARE_HIGH = 0.7;
/** Below this the percentage band is noise, so we say nothing. */
const MIN_ESTIMABLE_PERMIT_VALUE = 5_000;

/** Parse a display value string ("$74K", "$1.2M", "$300", "$1,200")
 *  into absolute dollars. Returns null when there's no usable number. */
function parseValueToDollars(value: string): number | null {
  const numeric = parseFloat(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/m/i.test(value)) return numeric * 1_000_000;
  if (/k/i.test(value)) return numeric * 1_000;
  return numeric;
}

/** Format absolute dollars back into a compact display string. Mirrors
 *  `formatCurrency` in src/types/lead.ts so the proposal reads in the
 *  same units as the permit value shown above it in the drawer. */
function formatDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** Turn the lead's `value` string into a self-documenting contract-value
 *  band. Returns null when the value is unparseable or below the
 *  $5K bar where the percentage estimate becomes too noisy to share. */
function estimateRevenue(value: string | null | undefined): string | null {
  if (!value) return null;
  const dollars = parseValueToDollars(value);
  if (dollars == null || dollars <= MIN_ESTIMABLE_PERMIT_VALUE) return null;
  const low = formatDollars(dollars * PERMIT_VALUE_SHARE_LOW);
  const high = formatDollars(dollars * PERMIT_VALUE_SHARE_HIGH);
  return `${low} - ${high} — 40-70% of the ${formatDollars(dollars)} permit value (rough anchor, not a quote)`;
}

/** Default proposal when the trade isn't in the lookup table — generic
 *  but still permit-specific via `age` + `lead.type`. `age` is null when
 *  the filing date is unknown; the "filed N days ago" clause is dropped
 *  entirely rather than asserting a date we don't have. */
function defaultProposal(lead: ProposalLeadInput, age: number | null): TradeProposal {
  const type = lead.type ?? "construction";
  // Truthfulness (audit 2026-08-04): the closing sentence used to read
  // "Early outreach significantly increases close rates." Henri has never
  // measured the effect of outreach timing on close rate. Replaced with a
  // statement about what the contractor controls, which needs no cohort.
  const closing =
    "The property owner is in the planning phase and actively evaluating contractors. Reaching out before they have collected competing bids is the main lever you control.";
  return {
    headline: "New construction permit — active project",
    insight:
      age == null
        ? `A ${type} permit is on file (filing date unknown). ${closing}`
        : `A ${type} permit was filed ${age} days ago. ${closing}`,
    actions: [
      "Contact within 48 hours for first-mover advantage",
      "Prepare a detailed estimate based on permit scope",
      "Offer a site visit to assess conditions and refine pricing",
    ],
  };
}

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Generate a permit-specific proposal for the given lead. Pure function
 * — same input always produces same output. Wedge bullet #4 (outreach
 * is permit-specific): the result references the permit's age, value,
 * and description, never a generic template.
 */
export function generateProposal(lead: ProposalLeadInput): Proposal {
  const trade = (lead.trade ?? "other").toLowerCase();
  // `null` = filing date unknown. Never coerced to 0 — see normalizeAge.
  const age = normalizeAge(lead.permitAge);
  const desc = (lead.permitDescription ?? "").toLowerCase();

  const tradeBuilder = TRADE_PROPOSALS[trade];
  const match = tradeBuilder ? tradeBuilder(desc) : defaultProposal(lead, age);

  return {
    headline: match.headline,
    insight: match.insight,
    urgency: urgencyFromAge(age),
    actions: match.actions,
    window: windowFromAge(age),
    estimatedRevenue: estimateRevenue(lead.value ?? null),
  };
}
