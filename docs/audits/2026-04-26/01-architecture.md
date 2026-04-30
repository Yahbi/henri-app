# 01 — Architecture

## TL;DR

Henri's project structure is feature-driven and consistent. Routes are organized by audience (`(dashboard)` / `(homeowner)` / `(marketing)` / `(auth)` route groups), components are co-located by domain, and lib modules stay on the server side. The dashboard is correctly contractor-only with a centralized middleware gate. The single architectural concern is **component bloat**: four files exceed 800 LOC each (`ChatIntakeModal` 1,028, contractors page 916, `LeadDetailDrawer` 889, `dashboard/map/page.tsx` 828) — none are bugs today but each is a future-debugging hazard.

## Score

**HEALTHY** — solid bones; refactor large components when you have a slow week.

## Inventory

| Surface | Count | Notes |
|---|---|---|
| `src/app/(dashboard)/*` routes | 21 | Contractor dashboard. `dashboard/leads/`, `pipeline/`, `analytics/`, `outreach/`, `intel/`, `storm/`, `jobs/`, `canvass/`, `permits/`, `messages/`, `compliance/`, `estimate/`, `roi/`, `financing/`, `blast/`, `reputation/`, plus `settings/{billing,capacity,territories,account,interviews,referrals}` |
| `src/app/(marketing)/*` routes | 9 | `/`, `/pricing`, `/contractors`, `/portal`, `/terms`, `/privacy`, `/acceptable-use`, `/review/[token]` |
| `src/app/(homeowner)/*` routes | 3 | `/homeowner`, `/homeowner/intakes/[id]`, etc. |
| `src/app/(auth)/*` routes | 2 | `/login`, `/signup` |
| `src/app/api/*` route handlers | 98 | See [04-api-surface.md](./04-api-surface.md) |
| `src/components/ui/*` primitives | 11 | Button, Card, Badge, Dialog, Input, Select, Skeleton, Toast, FocusTrap, ExpandableBanner, Tooltip |
| `src/components/dashboard/*` | 19 | LeadDetailDrawer, LeadCard, LeadsPanel, ScoreBreakdown, PermitTimeline, etc. |
| `src/components/map/*` | 15 | MapDashboard, FEMAFloodLayer, CensusLayer, NOAARadarLayer, SPCOutlookLayer, ParcelLayer, ZoningLayer, etc. |
| `src/components/{landing,marketing,portal,pipeline,analytics,homeowner,settings,dev}/*` | ~25 | Domain-grouped |
| `src/hooks/*` | 29 | `useLeads`, `useExclusivity`, `useEnrichment`, `usePermitHistory`, `useCapacityPrefs`, `useGodMode`, `useEstimates`, `useFunnel`, etc. |
| `src/lib/*` modules | 87 across 28 subdirectories | `auth/`, `scoring/`, `exclusivity/`, `enrichment/`, `permits/`, `territories/`, `sequences/`, `supabase/`, `stripe/`, `twilio/`, `resend/`, `openai/`, `ingest/`, `capacity/`, `matching/`, `scrapers/`, etc. |
| `src/types/*` | 8 | `lead.ts`, `estimate.ts`, `profile.ts`, etc. |
| Total LOC | ~68k | Per agent count |

## Findings

### F1 — `ChatIntakeModal.tsx` is 1,028 LOC and couples chat UI with prompt engineering

- **Severity**: Medium
- **File**: `src/components/portal/ChatIntakeModal.tsx`
- **Why it matters**: Single-file monoliths are hard to debug when the AI flow misbehaves under real homeowner traffic. Prompt strings and intake state mutation are entangled with the modal's render logic, which makes future A/B testing (different prompts for different trades) require touching UI code.
- **Recommendation**: Extract three modules: `lib/intake/prompts.ts` (system prompt + per-trade variants), `lib/intake/state-machine.ts` (intake step transitions + validation), `components/portal/ChatIntakeModal.tsx` (presentation only). Target ~300 LOC for the modal post-refactor.

### F2 — `LeadDetailDrawer.tsx` is 889 LOC and embeds proposal generation logic

- **Severity**: Medium
- **File**: `src/components/dashboard/LeadDetailDrawer.tsx`
- **Why it matters**: The drawer is the most visible surface in the app (every clicked lead opens it), so changes here are high-stakes. Today it owns: rendering, `generateProposal()` business logic, urgency calculation, score-breakdown rendering, permit timeline composition, contractor/business section rendering, and enrichment state passthrough. A bug in any of these regresses the whole drawer.
- **Recommendation**: Extract `generateProposal()` to `src/lib/proposals/generate.ts` (with unit tests — the function is pure). Extract the contractor/business section into `src/components/dashboard/ContractorBusinessSection.tsx`. Target ~500 LOC for the drawer post-refactor.

### F3 — `src/app/(marketing)/contractors/page.tsx` is 916 LOC for a single landing page

- **Severity**: Medium
- **File**: `src/app/(marketing)/contractors/page.tsx`
- **Why it matters**: The /contractors marketing page mixes a comparison table, anti-Angi positioning, sourced-claims block, pricing tier cards, and FAQ — each is a distinct concern and the file size makes it hard to update one section without scrolling past four others. The comparison table is also the source-of-truth for the new battlecard (see verification rule #6 in `docs/audits/henri-audit-2026-04-26.md`); when these drift, both surfaces lie.
- **Recommendation**: Extract the comparison table to `src/components/marketing/CompetitorComparisonTable.tsx` and import it from both `/contractors/page.tsx` AND the battlecard generator next time the skill runs. That removes the drift risk entirely. Target ~500 LOC for the page post-refactor.

### F4 — `src/app/(dashboard)/dashboard/map/page.tsx` is 828 LOC

- **Severity**: Medium
- **File**: `src/app/(dashboard)/dashboard/map/page.tsx`
- **Why it matters**: This is the dashboard map view, which already has 7 hardcoded `#D4886A` literals (justified — MapLibre paint props don't resolve CSS variables). The size compounds the issue: when the design audit's #4 priority closed out, this file was the largest single concentration of justified literals AND it's where future map-overlay work happens. Changes are high-coupling.
- **Recommendation**: Extract layer-management state (`overlays`, `setOverlays`, the toggle handlers) into a `useMapOverlays()` hook. Extract the GeoJSON-build helpers into `src/lib/map/build-features.ts`. The `page.tsx` should be a 300-line orchestrator, not the layer factory.

### F5 — Route group naming uses `(group)` parentheses correctly

- **Severity**: Nitpick (positive)
- **File**: `src/app/(dashboard)/`, `src/app/(marketing)/`, `src/app/(homeowner)/`, `src/app/(auth)/`
- **Why it matters**: Route groups are the modern Next.js way to share layouts without polluting URLs. Henri uses them consistently, which means `/dashboard/leads` doesn't have a `(dashboard)` segment in the URL but DOES inherit `DashboardTopBar` from `(dashboard)/layout.tsx`. Keep this discipline.
- **Recommendation**: None — this is working well. Documenting it here so future contributors don't accidentally flatten the structure.

### F6 — Per-page navs (PortalNav, ContractorNav) coexist with `MarketingNav`

- **Severity**: Low
- **Why it matters**: `CLAUDE.md` says "marketing pages with per-page navs (PortalNav, ContractorNav)". This is intentional: the homeowner portal nav is different from the contractor pitch nav. But it means three navigation components exist for marketing, and onboarding a new marketing surface requires deciding which nav (or building a new one) without a documented decision tree.
- **Recommendation**: Add a 3-line comment to `src/components/marketing/MarketingNav.tsx` describing when to use which: "use MarketingNav for /, /pricing, /terms, /privacy. Use PortalNav for /portal flow. Use ContractorNav for /contractors pitch flow."

### F7 — Two parallel routing files: `src/middleware.ts` AND `src/proxy.ts`

- **Severity**: High
- **File**: `src/middleware.ts` + `src/proxy.ts`
- **Why it matters**: `CLAUDE.md` explicitly lists both as "load-bearing" and warns "do not touch without explicit approval". Having two routing entrypoints is a known code-smell — Next.js docs only describe `middleware.ts`. If `proxy.ts` is dead code or a vestigial earlier attempt, it's a comprehension trap; if it's actively wiring routes, it should be documented in `AGENTS.md` (which currently only has the Next.js-16 caveat) and the relationship spelled out.
- **Recommendation**: Read both files end-to-end, document the relationship in a comment at the top of each, and either consolidate into one file or add a `routing-architecture.md` doc explaining the split. Critical because every routing change ships through one of these two files.

### F8 — `src/lib/` has 28 subdirectories — boundary discipline matters here

- **Severity**: Low
- **File**: `src/lib/`
- **Why it matters**: 28 subdirectories is a lot. Some are clearly per-vendor (`stripe/`, `twilio/`, `resend/`, `openai/`, `mapbox/` — good), some per-domain (`scoring/`, `exclusivity/`, `capacity/`, `enrichment/`, `permits/`, `territories/` — good), and some are utility (`utils/`, `constants/`, `auth/`, `supabase/` — good). But there's also `matching/`, `sequences/`, `ingest/`, `scrapers/`, `proposals/`, `agents/`, `intel/` — overlap risk. E.g. is `matching/` a subset of `scoring/`? Is `agents/` AI-agent-related or workflow-agent-related?
- **Recommendation**: Add a `src/lib/README.md` (10 lines, one per top-level subdirectory) explaining what each module owns. Defers the "should we collapse some of these?" decision but at least makes the current state legible.

### F9 — `src/app/api/agents/*` and `src/app/api/dev/*` are unfamiliar surfaces

- **Severity**: Low
- **File**: `src/app/api/agents/{ziplock,lead-scorer,permit-scraper}/route.ts`, `src/app/api/dev/*`
- **Why it matters**: Most API routes follow obvious naming (`leads/`, `permits/`, `webhooks/`). The `agents/` namespace and individual routes (`ziplock`, `lead-scorer`, `permit-scraper`) need context — are they internal RPC endpoints? Are they invoked by cron? Are they invoked by an LLM agent (could be prompt-injection surface)? Likewise `dev/*` is gated by `NODE_ENV` per the security agent's findings, but the audit reader has to confirm that for each route.
- **Recommendation**: Add a top-of-file comment to each `agents/*/route.ts` file describing: who calls this, what auth gate, what side effects. Same for `dev/*` (already done for `switch-role` per the security audit, do the others too).

## What's working well

- **Route groups are used correctly** — each group has a layout.tsx that scopes the nav and shell.
- **`requireContractor()` is centralized** in `src/lib/auth/requireContractor.ts` — one helper, no copy-paste auth-gating logic.
- **Component primitives are consolidated** in `src/components/ui/*` — 11 primitives, no parallel implementations elsewhere.
- **Co-location pattern**: `src/components/dashboard/`, `src/components/map/` keep dashboard-only and map-only components close to their consumers, while `src/components/ui/` stays generic.
- **Hook discipline**: 29 hooks, every one read-only or mutation-only — no hidden side effects.
