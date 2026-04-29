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
      ? "Full roof replacement permits have a 35% close rate when contacted within 72 hours. Property owner is actively sourcing bids."
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
        ? "Whole-house plumbing work signals a committed homeowner. These projects rarely get cancelled and close at high rates."
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
    insight:
      "Solar permit holders have already committed to the project and are comparing installers. Focus on timeline, warranty, and monitoring. These leads close at 40%+ when contacted within 48 hours.",
    actions: [
      "Lead with production estimates specific to their roof orientation",
      "Highlight battery storage add-on for increased value",
      "Provide utility rate analysis showing ROI timeline",
    ],
  }),
  adu: () => ({
    headline: "ADU construction — major project opportunity",
    insight:
      "Accessory dwelling units are high-value, multi-trade projects ($80K-$200K+). The permit holder needs GC coordination across foundation, framing, plumbing, electrical, and finishes.",
    actions: [
      "Offer a comprehensive build package or GC services",
      "Provide a detailed timeline with milestones",
      "Discuss financing options — many ADU builders use construction loans",
    ],
  }),
  "general remodel": (desc) => ({
    headline: "Renovation project — multi-trade potential",
    insight: desc.includes("kitchen")
      ? "Kitchen remodels average $35K-$75K and often expand in scope. Position as a full-service renovation partner."
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

function urgencyFromAge(age: number): Proposal["urgency"] {
  if (age <= 3) return "high";
  if (age <= 10) return "medium";
  return "low";
}

function windowFromAge(age: number): string {
  if (age <= 2) return "48 hours — first-mover advantage";
  if (age <= 7) return `${7 - age} days before competitive saturation`;
  return "Follow up promptly — other contractors may have reached out";
}

/** Parse the lead's `value` string ("$74K", "$1.2M", "$300") into a
 *  formatted contractor-revenue range. Returns null when the value is
 *  unparseable or below the $5K bar where the percentage estimate
 *  becomes too noisy to share. */
function estimateRevenue(value: string | null | undefined): string | null {
  if (!value) return null;
  const rawVal = parseFloat(value.replace(/[$K,M]/g, "") || "0");
  if (value.includes("M")) {
    return `$${(rawVal * 0.15).toFixed(0)}K - $${(rawVal * 0.25).toFixed(0)}K contractor revenue`;
  }
  if (value.includes("K") && rawVal > 5) {
    const low = Math.round(rawVal * 0.4);
    const high = Math.round(rawVal * 0.7);
    return `$${low}K - $${high}K estimated contract value`;
  }
  return null;
}

/** Default proposal when the trade isn't in the lookup table — generic
 *  but still permit-specific via `age` + `lead.type`. */
function defaultProposal(lead: ProposalLeadInput, age: number): TradeProposal {
  return {
    headline: "New construction permit — active project",
    insight: `A ${lead.type ?? "construction"} permit was filed ${age} days ago. The property owner is in the planning phase and actively evaluating contractors. Early outreach significantly increases close rates.`,
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
  const age = lead.permitAge ?? 0;
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
