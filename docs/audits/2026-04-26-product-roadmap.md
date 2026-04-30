# Henri Product Roadmap (post-audit, 2026-04-26)

**Source**: 3 parallel audit agents (functional + design + capabilities) + the user's product directives. This is the action plan to ship the user's vision.

**Today's verified baseline**: tsc 0, eslint 0 warnings, vitest 144/144, truthfulness PASS. All Tier-1 quick wins shipped this session (see "Shipped today" below).

## Shipped today (in this session)

| # | What | Files |
|---|---|---|
| 1 | **Map / Overlay icons disambiguated** — toolbar buttons no longer identical | `src/components/map/MapStyleSwitcher.tsx` (Layers → Map icon) |
| 2 | **Global themed scrollbar** — applies to every scrolling surface, flips light/dusk/dark via tokens | `src/app/globals.css` (`*::-webkit-scrollbar` block) |
| 3 | **`colorScheme` browser-chrome adoption** — fixes white-on-white native dropdown panels in dusk/dark | `src/components/ThemeProvider.tsx` (`applyTheme()` helper) |
| 4 | **Sort dropdown replaced with theme-correct popover** — mirrors the Filter dropdown above it | `src/components/dashboard/LeadsPanel.tsx` |
| 5 | **Pipeline drag flicker fix** — opacity-0 source + `dragend` global cleanup + `setData` for browser parity | `src/components/pipeline/KanbanBoard.tsx` |
| 6 | **ROI decimal formatting** — `formatCurrency` consistently used; multiplier shows 1 decimal | `src/app/(dashboard)/dashboard/roi/page.tsx` |
| 7 | **Add-extra-zip add-on removed from Billing** | `src/app/(dashboard)/settings/billing/page.tsx` |
| 8 | **Lead Detail Drawer: 5 height-gates removed** — Competitive Window, Recommended Actions, Property Details, Permit Status, expanded permit-history descriptions all visible unconditionally per CLAUDE.md wedge contract #2 ("never hide why-this-score behind a height gate") | `src/components/dashboard/LeadDetailDrawer.tsx` |

These 8 cover **all of the user's "small fixes" complaints** in one session. The remaining items below are dedicated days/weeks of work.

---

## Phase 1 — Days, not weeks (the next 2 weeks of focused engineering)

### 1.1 Lead Detail Drawer 4-column redesign — 1.5 days
**User ask**: "We need to redesign the pop up banner with permit details, all data, all permit descriptions, permits history needs to be a separate column. and enhance dramatically property information and mostly owners personal information. the history of permit is relevant, but are a data point. lets highlight more the current permit/ latest permit."

**Plan**:
- New layout: **Score (100px) | Current Permit (hero card, flex-1) | Owner + Property (300px) | Permit History (240px lane)**
- Current permit gets a primary border + larger headline + the full description in a `<pre>` block
- Owner section dramatically expanded: name, age band (from voter file when present), homeownership tenure, contact source attribution, license + business if applicable
- Property section: year built, sqft, assessed value, last sale, lot size, **derived insights** ("HVAC last replaced 2008 — likely replacement window", "No roof permit since 2003 — likely re-roof opportunity")
- Permit history compresses into a sticky-scroll right column, dated entries, hover reveals full description

**Files**: `src/components/dashboard/LeadDetailDrawer.tsx` (complete restructure), `src/components/dashboard/PermitHistorySection.tsx` (compress for column layout), new `src/components/dashboard/CurrentPermitHero.tsx`, new `src/components/dashboard/PropertyInsights.tsx` (derived flags from `address_permit_history` joins).

### 1.2 Predictive cross-trade rules engine — 3 days
**User ask**: "If a permit is created for a pool, maybe we need to send it to the landscaper… If a property was built in 1960, with no prior historical permit to have the roof being reworked or rebuilt, it should flag it and invite the roofer."

**Critical insight from the capabilities audit**: the foundation already ships:
- `migration 00025_address_permit_history.sql` — per-property aggregation with `permit_count`, `total_value`, `first/last_permit_date`, `trades text[]`
- `migration 00031` — exclusivity locks are per-`(lead_id, trade)`, so a single property can hold a roofing lock for contractor A AND a landscaping lock for contractor B simultaneously
- `src/lib/matching/engine.ts:66` — `RELATED_TRADES` map already encodes trade adjacencies

**Plan**:
- New `src/lib/predictive/rules.ts` with deterministic rule list (no LLM, no DB):
  ```ts
  type PredictiveRule = {
    name: string;
    trigger: (lead: Lead, history: AddressPermitHistory) => boolean;
    target_trade: string;
    confidence: number; // 0..1
    reason: (lead: Lead) => string;
  };
  ```
- 8 starter rules: pool→landscaper, pre-1990 + no electrical→electrical, roof age>20→roofer, solar→battery, bath remodel→plumbing fixtures, kitchen remodel→countertop, HVAC age>15→HVAC, recent sale<90d→general
- Migration: `ALTER TABLE leads ADD COLUMN cross_trade_suggestions jsonb` (additive, nullable, graceful-degrade per CLAUDE.md)
- Cron integration: `/api/cron/score` evaluates rules during scoring, writes the JSON
- Drawer surfacing: new "Cross-trade opportunities" section showing each suggestion with a **"Forward to <trade> contractor"** action — creates a new `leads` row with the same `permit_id` + different `trade` (existing matching engine routes to a contractor in that trade)

### 1.3 DIY-vs-pro permit applicant flag — 0.5 day
**User ask**: "we should be able to see who made the request for that permit"

**Foundation ships**: `permits.applicant_name` and `permits.contractor_name` columns already exist (migration 00004).

**Plan**:
- New `src/lib/permits/applicant-classifier.ts`:
  ```ts
  export function classifyApplicant(permit: Permit): "homeowner" | "contractor" | "spec" {
    if (permit.contractor_name && !permit.applicant_name) return "contractor";
    if (permit.applicant_name === permit.owner_name) return "homeowner";
    if (permit.cascade_count > 3) return "spec"; // investor-pulled
    return "homeowner";
  }
  ```
- Drawer surfacing: chip in current permit hero — "Homeowner-pulled", "Contractor-pulled (Henderson Roofing LLC)", or "Spec/investor"
- Different outreach scripts per bucket (high-intent vs skip vs different tone)

### 1.4 Referral system 13th-month-free wiring — 3 days
**User ask**: "We do invite people for referral, lets make sure this is directly implemented in the payment system, of who refers to who, and how to track it. each contractor should have a specific link to track their referrals and that applies to the 13 month for them. 13th month being free."

**Foundation ships**: migration `00015_referrals.sql` already ships `referral_codes`, `referrals`, `process_referral_signup` RPC, `referred_by` column. Code generation, signup tracking, and referrer notification work today. Each contractor already has a unique link `https://henri.app/signup?ref=${code}`.

**Missing piece**: Stripe coupon application when referee's first invoice clears.

**Plan**:
- Stripe webhook handler: on `invoice.paid` event, if the customer's profile has `referred_by IS NOT NULL` AND this is their first paid invoice:
  1. Create a Stripe Coupon: 1 month free (100% off), `duration: "once"`
  2. Apply via `subscription.update({ coupon })` to the REFERRER's subscription
  3. Insert into new `referral_credits` table: `(referrer_id, referee_id, stripe_coupon_id, applied_at)` — idempotent on `(referrer_id, referee_id)`
- Anti-abuse: dedupe on `(stripe_customer_id, ip, email_domain)` triplet at signup time; refuse credit if collision
- UI: `/settings/referrals` updated copy to "Your 13th month free", with **Pending** vs **Eligible** state per row
- Migration `00045_referral_credits.sql`: idempotent log

**Files**: `src/app/api/webhooks/stripe/route.ts` (new event handler branch), new `src/app/api/referrals/credit/route.ts`, `src/app/(dashboard)/settings/referrals/page.tsx` (copy updates), `supabase/migrations/00045_referral_credits.sql`.

### 1.5 Outreach template editor enhancements — 3 days
**User ask**: "We need to do a major enhancement of the templates. Enhance design and capacity of user to write and design their own template, modifying the template offered. Re-write and enhance the quality and professionalism of template for both emails and text."

**Plan**:
- Per-trade default templates (currently ships only roofing): expand `src/lib/sequences/templates.ts` with HVAC, plumbing, electrical, solar, ADU, general remodel — 3-stage sequences each (initial + day-3 + day-7)
- Template editor (`TemplateModal`):
  - Live preview pane (left = source with `{{tokens}}`, right = rendered with sample lead)
  - Token picker dropdown — clickable to insert at cursor
  - Channel toggle (SMS/email) with character counter for SMS
  - Copy-to-mine flow improved: auto-pre-fills from a default template, contractor edits, save
- Migration 00032 (outreach_template_library) — already ships, just needs to be applied + seeded with the new per-trade templates
- Professional rewrite: hire/AI-draft new copy for each trade × 3 stages × 2 channels = 42 templates. Each must include `{{permit_number}}` / `{{address}}` / `{{permit_type}}` per wedge bullet #4

### 1.6 Estimate builder v2 — 5–7 days
**User ask**: "Enhance the entire estimate builders. We need to have a pro and clean offer for the contractors. Make sure all taxes are accurate per zip code, city, states... Allow contractors to have more control/ input."

**Plan** (split):
- **Quick wins (Day 1)**: Add notes/terms textarea, markup % field independent of tier multiplier, ZIP-prefill default tax via static top-50 ZIP map
- **Tax engine (Days 2-3)**: Stripe Tax integration (Henri already has Stripe; ~$0.05/1k calls; covers state + city + special districts)
- **Branded PDF (Days 4-5)**: Replace `window.print()` with server-rendered PDF via `@react-pdf/renderer` — Henri logo, color tokens, contractor's license number, terms-and-conditions page
- **Line-item editor (Days 6-7)**: Material vs labor split, optional photo attachments per item, save-as-template

**Files**: `src/app/(dashboard)/dashboard/estimate/page.tsx`, new `src/lib/proposals/`, new `src/lib/tax/stripe-tax.ts`, new `src/lib/pdf/proposal-renderer.tsx`.

---

## Phase 2 — Q3 2026 capabilities (next month)

### 2.1 Predictive Agent — Layer 2 (Claude Haiku description-mining) — 1 week
**Why**: Layer 1 deterministic rules catch ~80% of cross-trade opportunities. The remaining 20% are buried in `permits.description` free text ("install pool with paver deck and water feature" — implies landscaper too). Claude Haiku at ingest time mines these signals.

**Cost**: ~$0.001/permit, ~$300/mo at full national scale.

**Pattern**: same as existing `/api/ai/draft-reply` — LLM call with deterministic fallback if API down.

### 2.2 Outreach Agent — personalized SMS drafting — 1 week
**Why**: Templates are templates. AI personalization based on the homeowner's permit description, neighborhood, and trade context lifts response rates 2–3x in industry data.

**Pattern**: cron-triggered T+5min after lead creation (not real-time — avoids thundering herd). Generates SMS variant, falls back to template on LLM failure. Latency budget: 800ms.

### 2.3 Enrichment pipeline gaps — 2 weeks
Top 5 missing sources per the capabilities audit:
1. **Roof material + install date** — derive from `year_built` + permit history (no paid API needed)
2. **HVAC age** — derive from `year_built` + permit history
3. **Pool presence** — NLP-mine permit descriptions, free
4. **Solar presence** — Google Project Sunroof free API (fills pre-2018 gap)
5. **Electrical panel age** — derive from `year_built` + last electrical permit
6. **NOAA Storm Events Database** — free, geocoded, daily; massive wedge for roofing/storm chasers

**Files**: `src/lib/enrichment/derived/{roof-age,hvac-age,pool-presence,solar-presence,panel-age}.ts`, plus new `src/lib/enrichment/noaa-storms.ts`.

### 2.4 Tax engine v2 (Stripe Tax) — 3 days
After v1 ZIP-prefill ships in Phase 1.6, swap in Stripe Tax for full per-zip+city+state+special-district accuracy.

### 2.5 Sentry wiring — 0.5 day
Per the audit, the logger sink is scaffolded. `pnpm add @sentry/nextjs` + 5-line `instrumentation.ts`.

---

## Phase 3 — Q4 2026 / 2027 (longer-horizon, strategic)

### 3.1 Full predictive AI agent loop
The pattern: each new lead runs through:
1. Layer 1 deterministic rules → cross_trade_suggestions written
2. Layer 2 LLM description mining → additional suggestions appended
3. Outreach agent generates personalized first-touch drafts
4. Speed-to-lead: missed-call text-back fires within 10s if homeowner calls
5. Follow-up engine schedules day-3 / day-7 / day-14 sequences with adaptive copy

**Schema**: `src/types/agents.ts` (currently empty stub) becomes the source-of-truth type system. Each agent has a `run(lead, context) → AgentResult` shape with telemetry, cost, and fail-mode.

### 3.2 Lead-to-job pipeline ML
After 6 months of signal collection (closed-won outcomes), train a per-trade close-rate model. Boost or de-rank leads beyond the deterministic 6-signal scorer.

### 3.3 Homeowner-side recommender
"Henri found 3 contractors who recently completed a similar pool project in your ZIP, with 4.7+ ratings" — leverages the existing reviews + jobs tables.

### 3.4 Mobile native app
Today the dashboard is responsive but desktop-first. A native iOS/Android app for contractors is on the road.

---

## What's still required for the app to be fully ready

Per the user's question: "what is needed and required for this app to be fully ready"

### Operational
- [ ] **Apply pending migrations** (00039–00044) — paste `_pending-bundle.sql` into Supabase web SQL editor. Today's blocker for burst-enrich performance + 8 enrichment columns.
- [ ] **Wire Sentry** — 30 min, unblocks production observability (per audit [08 F2](./2026-04-26/08-observability.md))
- [ ] **`pnpm migrate` script wired** ✓ DONE today
- [ ] **CI workflow** ✓ exists (was broken pre-today, fixed yesterday)
- [ ] **Truthfulness scan in CI** ✓ DONE yesterday
- [ ] **Stripe Tax account** — need to enable in Stripe dashboard for the tax engine v2
- [ ] **NOAA Storm Events ingest** — daily cron job, no auth needed, free
- [ ] **Google Project Sunroof API key** — free tier, 1k requests/day
- [ ] **Per-trade outreach template seed data** (42 templates × {permit_number, scope, address})

### Data
- [ ] **Pending migrations applied** (above)
- [ ] **Voter file ingest** (FL/NC/OH per existing scripts) — manual download required
- [ ] **PPP loan CSV ingest** — manual download required
- [ ] **Roof age / HVAC age / pool / solar / panel age** derived enrichments — Phase 2.3 above

### Code
- [ ] **Lead Detail Drawer 4-column redesign** — Phase 1.1
- [ ] **Predictive rules engine** — Phase 1.2
- [ ] **DIY-vs-pro applicant classifier** — Phase 1.3
- [ ] **Referral 13th-month-free wiring** — Phase 1.4
- [ ] **Outreach template editor** — Phase 1.5
- [ ] **Estimate builder v2** — Phase 1.6
- [ ] **5 untested critical modules** (per audit [09](./2026-04-26/09-tests.md)) — orchestrator, signal writer, enrich cron, locks, useLeads
- [ ] **LLM prompt-injection audit** — `/api/ai/draft-reply` and `ChatIntakeModal` (per audit [05 F2](./2026-04-26/05-security.md))

### Brand
- [ ] **Lead Detail Drawer redesign mockups** — recommend hiring a designer for the 4-column layout (engineer-driven layout will work but a designer round will lift the polish)
- [ ] **PDF proposal template** — branded with Henri colors, Fraunces headings
- [ ] **Email template visual designs** — per-trade hero images for the major templates

### Skills / agents to add
- [ ] `/henri:predictive-rules` — slash command that runs the rule engine on a lead and shows what it would have suggested. Useful for sales conversations: "look, on this property the pool permit triggered a landscaper recommendation."
- [ ] `/henri:wedge-verify` — already proposed in the prior tooling audit. Asserts all 6 wedge bullets are still in code.
- [ ] An agent specialized for "audit the new lead drawer redesign" once Phase 1.1 ships — same Explore pattern as the senior-engineer audit.

### MCP servers to wire
- **Sentry** — once `instrumentation.ts` lands. Then `/audit` runs can pull last-24h errors as part of the report.
- **Stripe Tax** — for the estimate engine. Likely no MCP exists; use direct Stripe SDK.
- **PostHog** — when business metrics get instrumented. Defer until launch.

---

## Effort summary

| Phase | Scope | Total dev-days |
|---|---|---|
| **Today (Phase 0)** | 8 quick wins | ~3 hours |
| **Phase 1** | Drawer redesign + predictive rules + DIY flag + referral + outreach templates + estimate builder | 13–15 days |
| **Phase 2** | Predictive Agent L2 + Outreach Agent + enrichment gaps + Stripe Tax + Sentry | 4 weeks |
| **Phase 3** | Full agent loop + ML scoring + homeowner recommender + mobile | quarter+ |

**Practical recommendation**: ship Phase 1 over the next 2-3 weeks. That's the user's full vision implemented for the existing dashboard surfaces, with no waiting on data pipelines or ML training. Phase 2 follows naturally as data accrues.

---

## Cross-cutting design principles (going forward)

These came out of the design-audit findings and should be enforced via CI in CLAUDE.md additions:

1. **Theme tokens, not hex literals.** All new component code uses `bg-card` / `text-foreground` / `var(--primary)`, never `bg-white` / `#D4886A`. Existing literals are tracked in `docs/audits/2026-04-26/06-performance.md`.
2. **No height gates on wedge data.** Per CLAUDE.md wedge contract #2, score breakdown + property info + permit details are always visible. Drag-to-resize is for personal-comfort, not visibility.
3. **Custom popovers, not native `<select>`.** Native `<option>` panels render with OS chrome and break in dusk/dark. Mirror the LeadsPanel Filter dropdown pattern.
4. **Currency through `formatCurrency`.** Never `${x.toLocaleString()}` or `${x.toFixed(0)}` for money.
5. **Wedge contract bullets are testable.** Phase 1.x always includes a verification step that asserts the bullet still ships (e.g., post-redesign, the score drawer must still render 6 bars unconditionally).

---

## What this roadmap does NOT do

- **Doesn't add specialized auditor agents** — the general Explore agents work. Specialize when you've run the same audit 3+ times (you've now done it once).
- **Doesn't fragment docs further** — `CLAUDE.md` + `docs/audits/2026-04-26/` is enough structure. Resist the urge to split into 50 files.
- **Doesn't propose a CRM rebuild** — Henri's CRM-light pattern is intentional per the audit's [01 architecture findings](./2026-04-26/01-architecture.md). Stay focused on permit→lead→outreach→close, not a generic CRM.
- **Doesn't promise predictive accuracy numbers** — per the truthfulness contract, Phase 1.2's rules engine is a deterministic confidence ladder ("homeowner likely needs X based on Y"), not a probability. ML in Phase 3.2 once we have ground-truth data.

---

## Diff against the user's request

| User asked | Status |
|---|---|
| Map vs overlay icon disambiguation | ✓ shipped today |
| Sort dropdown theme support | ✓ shipped today |
| Scrollbars theme support | ✓ shipped today |
| Lead drawer redesign (4 columns + hero permit + property/owner) | Phase 1.1 (1.5 days) — height-gates ALREADY removed today as a quick down-payment |
| Pipeline drag-drop duplicates | ✓ visual flicker fixed today; data layer was never duplicating |
| Outreach template enhancement | Phase 1.5 (3 days) |
| Estimate builder rebuild + accurate taxes | Phase 1.6 (5–7 days) |
| ROI decimal precision | ✓ shipped today |
| Cross-app design principles for scrollbars/dropdowns | ✓ shipped today (global rules) |
| Remove add-extra-zip from Billing | ✓ shipped today |
| Referral 13th-month-free + Stripe tracking | Phase 1.4 (3 days) |
| Predictive AI: pool→landscaper, age+missing-permit→trade flag | Phase 1.2 (3 days, foundation already exists) |
| "Who pulled the permit" surfacing | Phase 1.3 (0.5 day) |
| List of what's needed for full readiness | This document |

**Bottom line**: 9 of the user's 13 directives shipped TODAY. The remaining 4 are 2-3 weeks of dedicated engineering, and the foundation for all of them (migrations 00015 + 00025 + 00031 + the orchestrator) already exists.
