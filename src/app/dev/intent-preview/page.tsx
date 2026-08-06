/**
 * Dev-only preview of Module 1 UI surfaces (intent chip + reasons list +
 * save/hide buttons). Bypasses auth so the founder can eyeball the new
 * UI without needing dev-login env vars set.
 *
 * Renders 6 sample lead drawer headers — one per major opportunity
 * stage — with the chip, reasons, and action buttons in place. Mirrors
 * the exact JSX used in src/components/dashboard/LeadDetailDrawer.tsx.
 *
 * Not reachable in production: src/middleware.ts returns a bare 404 for
 * `/dev` and any `/dev/*` path when NODE_ENV === "production", before any
 * rendering happens. Local dev is unaffected — the same branch calls
 * NextResponse.next().
 *
 * This comment used to cite `proxy.ts` as the guard. There is no src/proxy.ts
 * in this repo and nothing had replaced it, so for a period this page served
 * HTTP 200 on meethenri.com with `robots: index, follow`. Middleware is the
 * real mechanism now; if that branch is ever removed, this page is public
 * again.
 */
import { IntentChip, IntentChipReasonsList } from "@/components/dashboard/IntentChip";

interface Sample {
  title: string;
  addr: string;
  permit: string;
  applicantBadge: string;
  stage: string;
  reasons: string[];
  description: string;
  age: string;
  value: string;
}

const SAMPLES: Sample[] = [
  {
    title: "Hot — permit just filed, no contractor",
    addr: "642 Park St, Hartford CT 06106",
    permit: "PB-2026-04219",
    applicantBadge: "Homeowner applicant",
    stage: "permit_filed_no_contractor",
    reasons: [
      "permit_filed_today",
      "permit_filed_no_contractor",
      "homeowner_phone_verified",
      "kitchen_bath_scope",
    ],
    description: "Kitchen remodel including new electrical panel and plumbing rework",
    age: "Filed today",
    value: "$78K",
  },
  {
    title: "Subcontractor opportunity — GC on a $100k+ job",
    addr: "1218 Maple Ave, Phoenix AZ 85004",
    permit: "BLD-2026-08801",
    applicantBadge: "Contractor applicant",
    stage: "permit_filed_with_contractor",
    reasons: [
      "contractor_listed_high_value",
      "subcontractor_opportunity",
      "multi_trade_scope",
      "high_project_valuation",
    ],
    description: "New addition + roof + HVAC system replacement; full mechanical and plumbing rough-in",
    age: "Filed 5 days ago",
    value: "$185K",
  },
  {
    title: "Homeowner-submitted lead",
    addr: "55 Sunset Dr, Austin TX 78701",
    permit: "—",
    applicantBadge: "Homeowner intake",
    stage: "homeowner_submitted",
    reasons: [
      "homeowner_submitted_request",
      "homeowner_phone_verified",
      "homeowner_email_verified",
      "homeowner_timeline_under_30d",
      "homeowner_budget_provided",
    ],
    description: "ADU build, 600sqft, looking for design + build by Q3",
    age: "Submitted 2 hours ago",
    value: "$210K (budget)",
  },
  {
    title: "Stalled permit — expediter opportunity",
    addr: "913 N Vermont Ave, Los Angeles CA 90029",
    permit: "BLD-2026-23115",
    applicantBadge: "Contractor applicant",
    stage: "stalled",
    reasons: [
      "stalled_permit",
      "expediter_opportunity",
      "plan_check_correction",
      "high_project_valuation",
    ],
    description: "Detached ADU; corrections requested on plan-check pass 2",
    age: "Filed 142 days ago",
    value: "$95K",
  },
  {
    title: "Pre-intent — old roof + recent home sale",
    addr: "37 Brookside Ln, Wellesley MA 02482",
    permit: "—",
    applicantBadge: "No permit",
    stage: "pre_intent",
    reasons: [
      "old_property",
      "old_roof_estimate",
      "recent_home_sale",
      "high_equity_proxy",
      "lot_supports_adu",
    ],
    description: "—",
    age: "—",
    value: "—",
  },
  {
    title: "Maintenance upsell — solar without battery",
    addr: "2415 Beach Blvd, Jacksonville FL 32250",
    permit: "ELEC-2018-90211",
    applicantBadge: "Contractor applicant",
    stage: "maintenance_upsell",
    reasons: [
      "old_completed_project",
      "warranty_expired",
      "completed_solar_no_battery",
      "replacement_cycle_due",
    ],
    description: "Rooftop solar panel installation, 8.4kW system",
    age: "Completed 7 years ago",
    value: "$32K (original)",
  },
];

function SampleCard({ sample }: { sample: Sample }) {
  return (
    <div className="relative bg-card border border-border rounded-lg p-4 shadow-sm">
      {/* Module 11 — Save/Hide buttons static preview */}
      <div className="absolute top-3 right-12 flex items-center gap-1">
        <button
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
          aria-label="Save lead"
          title="Save this lead"
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-bookmark"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
        </button>
        <button
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
          aria-label="Hide lead"
          title="Hide this lead"
          type="button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide-eye-off"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/></svg>
        </button>
      </div>
      <button
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
        aria-label="Close"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>

      <div className="text-[10px] uppercase tracking-wider text-[#D4886A] font-semibold mb-3">
        {sample.title}
      </div>

      <h2 className="text-sm font-semibold text-foreground">{sample.addr}</h2>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        Permit {sample.permit}
      </p>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-bg-subtle border border-border text-[10px] text-muted-foreground">
          {sample.applicantBadge}
        </span>

        {/* Module 1 — Intent chip */}
        <IntentChip stage={sample.stage} reasonCodes={sample.reasons} />
      </div>

      {sample.reasons.length > 0 && (
        <div className="mt-3">
          <IntentChipReasonsList reasonCodes={sample.reasons} topN={3} />
        </div>
      )}

      <div className="mt-3 text-[11px] text-foreground/80">
        <div className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-1">Scope of work</div>
        {sample.description}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Filed</div>
          <div className="text-foreground">{sample.age}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Value</div>
          <div className="text-foreground font-semibold">{sample.value}</div>
        </div>
      </div>
    </div>
  );
}

export default function IntentPreviewPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-heading font-normal text-3xl text-foreground">
            Henri. — Intent classification preview
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            6 sample lead drawer headers showing the new <span className="font-mono text-xs bg-bg-subtle px-1 rounded">IntentChip</span>,
            top-3 reason codes, and Save / Hide action buttons. Each tile mirrors the exact JSX used in
            <span className="font-mono text-xs bg-bg-subtle px-1 rounded ml-1">LeadDetailDrawer.tsx</span>.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Module 1 (intent), Module 11 (save/hide) — no auth, no DB calls. Backend wiring lives in
            <span className="font-mono text-xs bg-bg-subtle px-1 rounded ml-1">src/lib/intent/</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SAMPLES.map((s) => (
            <SampleCard key={s.title} sample={s} />
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <h2 className="font-heading font-normal text-xl text-foreground mb-3">
            Stage filter dropdown — LeadsPanel
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            5 new filter values added to the existing filter strip. Each maps 1:1 to the 11 allowed
            <span className="font-mono text-xs bg-bg-subtle px-1 rounded ml-1">opportunity_stage</span> values from the classifier.
          </p>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#D4886A]/40" /> Pre-intent
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#D4886A]/60" /> Permit, no contractor
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-300" /> Stalled / expired
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-300" /> Maintenance opportunities
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-300" /> Subcontractor opportunity
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
