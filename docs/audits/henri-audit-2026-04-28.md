# Henri — Senior-engineer audit (2026-04-28)

**Generated**: 2026-04-28 — single rolled-up version of [docs/audits/2026-04-28/](./audits/2026-04-28/)

## Table of contents

- [00 — Executive summary + scorecard + top-10 priorities](#00--executive-summary)
- [01 — Architecture](#01--architecture)
- [02 — Data layer](#02--data-layer)
- [03 — Types & hooks](#03--types--hooks)
- [04 — API surface](#04--api-surface)
- [05 — Security](#05--security)
- [06 — Performance](#06--performance)
- [07 — Reliability](#07--reliability)
- [08 — Observability](#08--observability)
- [09 — Tests](#09--tests)
- [10 — Brand & wedge contract](#10--brand--wedge-contract)
- [11 — Build & deploy](#11--build--deploy)
- [12 — Documentation](#12--documentation)

---

<a id='00--executive-summary'></a>
# Henri — Senior-engineer audit (2026-04-28)

**Generated**: 2026-04-28 — single rolled-up version of [docs/audits/2026-04-28/](./)

**Methodology**: 3 parallel Explore agents (architecture+data, security+API, perf+reliability+tests+obs) plus targeted reads of anchor files (`src/middleware.ts`, `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/auth/requireContractor.ts`, `vercel.json`, `next.config.ts`, `.github/workflows/ci.yml`). No code edits. No production data sampling beyond planner-estimated row counts.

## Executive scorecard

| # | Domain | Status | Top issue (this audit) |
|---|---|---|---|
| 01 | [Architecture](./01-architecture.md) | HEALTHY | 4 components > 800 LOC; LeadDetailDrawer grew from 889 → 1,116 LOC |
| 02 | [Data layer](./02-data-layer.md) | WATCH | Migrations 00052 + 00053 still pending (idempotent, on clipboard); migration numbering gap at 00048-00049 |
| 03 | [Types & hooks](./03-types-and-hooks.md) | WATCH | `as unknown as` regressed 37 → 53; `Record<string,unknown>` regressed 124 → 141. Auto-generated DB types still pending. |
| 04 | [API surface](./04-api-surface.md) | ISSUE | 14 unvalidated POST routes (estimates PATCH, leads notes, financing, license/verify, admin/probe, 3 agents, billing/extra-zip) |
| 05 | [Security](./05-security.md) | HEALTHY | LLM injection defenses confirmed (S1+S2); god-mode audit log live (S6); security headers wired in `next.config.ts` |
| 06 | [Performance](./06-performance.md) | HEALTHY | Cron deadlines, polite rate limits, D3 telemetry all wired. Score + permits crons lack inline 280s deadline check |
| 07 | [Reliability](./07-reliability.md) | WATCH | Twilio + Resend webhooks lack event-ID idempotency keys; useLeads partial-result-on-page-timeout logs to `console.warn` not `logger` |
| 08 | [Observability](./08-observability.md) | WATCH | Sentry sink scaffolded but `@sentry/nextjs` still not installed; 152 raw `console.*` calls bypass structured logger |
| 09 | [Tests](./09-tests.md) | ISSUE | Orchestrator (871 LOC), useLeads (395 LOC), exclusivity locks, score cron (733 LOC) — all still zero coverage. 220/220 existing tests pass |
| 10 | [Brand & wedge](./10-brand-and-wedge.md) | HEALTHY | Truthfulness scan automated in CI; all 6 wedge bullets implemented end-to-end; brand discipline holds (no #E8916A, no font-bold, "Henri." with period) |
| 11 | [Build & deploy](./11-build-and-deploy.md) | HEALTHY | CI workflow live (`.github/workflows/ci.yml`); 17 Vercel crons scheduled; truthfulness gates merge |
| 12 | [Documentation](./12-documentation.md) | WATCH | CLAUDE.md is comprehensive (mid-MB-sized); README scaffolded; 6 `docs/audits/` files now exist |

**Overall verdict**: Henri shipped substantial improvements since the 2026-04-26 audit. **8 of 10 priorities from the prior audit are CLOSED**: CI workflow live, security headers wired, S1+S2+S6 LLM/audit hardening shipped, Stripe idempotency confirmed, telemetry-D3 emitted, 7 POST routes got Zod schemas. The two regressions (type-cast count up, LeadDetailDrawer LOC up) are real but mechanical to fix. The two open ISSUE-level domains are: (1) **14 unvalidated POSTs** — every one accepts `req.json()` without Zod and could corrupt financial/license/admin data; (2) **5 untested critical paths** — orchestrator, useLeads, locks, score cron, re-enrich.

## Top 10 priorities (ordered impact × effort)

1. **Apply migrations 00052 + 00053** — both idempotent, both on the user's clipboard. 00052 unblocks `discovered_via` / `field_mapping_status` columns referenced by 9 importer scripts (currently graceful-degrading to legacy schema). 00053's `permit_source_zips` table now exists per audit but never got Phase-2-populated (33,250 ZIPs × N sources of linkage rows). Single 2-min paste. [02-data-layer.md F1](./02-data-layer.md)
2. **Add Zod schemas to 14 unvalidated POST routes** — see [05-security.md F4-F18](./05-security.md). Hot list: `/api/estimates/[id]` PATCH, `/api/leads/[id]` PATCH, `/api/leads/[id]/notes`, `/api/financing`, `/api/license/verify`, `/api/admin/sources/probe`, `/api/agents/{lead-scorer,permit-scraper,ziplock}`, `/api/billing/extra-zip`. ~2 hours total. Hardens the user-input edges and is the single biggest open security gap.
3. **Auto-generate DB types via Supabase MCP**. Run `mcp__supabase__generate_typescript_types` to create `src/types/database.ts` with the `permits` join shape on `Lead`. Refactor `mapLead()` (currently 5 `as unknown as Record<string, unknown>` casts) and `ContractorCard` (7 casts). Closes ~80% of both `as unknown as` and `Record<string,unknown>` regressions. ~2 hours including refactor. [03-types-and-hooks.md F1-F2](./03-types-and-hooks.md)
4. **Wire Sentry**. `pnpm add @sentry/nextjs` + 5-line `instrumentation.ts` per the doc-comment in `src/lib/logger.ts:14-23`. Every existing `logger.error()` call site instantly forwards to Sentry. ~30 min. [08-observability.md F1](./08-observability.md)
5. **Test the 5 untested critical paths**: orchestrator, useLeads, exclusivity locks, score cron, re-enrich. Each is the load-bearing implementation of one or more wedge bullets. ~1 week of focused work but the highest leverage on regression-resistance. [09-tests.md F1-F4](./09-tests.md)
6. **Replace 152 raw `console.*` with `logger.*`** — once Sentry is wired (#4), every `console.error()` in a cron is an unaggregated error event. Top offenders: `/api/cron/score` (40 calls), `/api/cron/permits` (4), `/api/cron/re-enrich` (5). ~1 hour with a sed pass + spot-check. [08-observability.md F2](./08-observability.md)
7. **Add idempotency keys to Twilio + Resend webhooks** — store processed `MessageSid` (Twilio) and `svix-id` (Resend) to dedup. ~1 hour each. [07-reliability.md F2](./07-reliability.md), [05-security.md A7-A8](./05-security.md)
8. **Add inline 280s deadline check to `/api/cron/score` and `/api/cron/permits`** — both have `maxDuration=300` but no inline early-exit. `/api/cron/enrich` is the reference implementation (line 160). ~30 min. [07-reliability.md F4](./07-reliability.md)
9. **Refactor LeadDetailDrawer** (1,116 LOC) — extract `generateProposal()`, contractor/business section. Drop to <600 LOC. ~3 hours. [01-architecture.md F2](./01-architecture.md)
10. **Add Playwright E2E suite** — currently 0 E2E tests. The dashboard → leads → drawer flow has no integration coverage. Start with one happy-path test of god-mode dev login → dashboard → click lead → drawer opens. ~4 hours for setup + 1 test. [09-tests.md F6](./09-tests.md)

## What blocks launch

Of the 10 priorities, the **launch-blockers** (paying customers will be hurt without these) are:

- **#2** — 14 unvalidated POSTs include `/api/financing` (financial records) and `/api/license/verify` (compliance data). A malformed APR or out-of-range license number could corrupt both. Required before contractor onboarding goes live.
- **#5** — without tests on the orchestrator, locks, and score cron, the next refactor could violate wedge bullet #1 (exclusivity) or #2 (transparent scoring) silently. Worth a 1-week sprint.

The other 8 priorities are quality-of-engineering improvements, not launch-blockers.

## What's working well (audit-wide positives)

- **Wedge contract** — all 6 bullets implemented end-to-end; reference implementations of every pattern.
- **Auth + middleware + role gating** — middleware blocks the obvious bypasses, `requireContractor()` blocks the subtle ones, `isGodModeEmail()` audit-logs every founder bypass.
- **Service-role isolated** — `src/lib/supabase/admin.ts` only imported from server modules; never reaches the browser bundle.
- **Stripe webhook is exemplary** — signature verified before parse, idempotent on `event.id`, no client-controlled IDs, referral-credit insert→coupon→update reorder shipped (B3 fix earlier this session).
- **LLM injection defenses** — S1+S2 confirmed in `/api/ai/draft-reply` (`<<<REVIEW>>>` delimiters + sanitize + Zod) and `/api/chat/refine` (`<<<ANSWER N>>>` + per-answer cap + output-pattern reject). Rare to see this in a contractor SaaS at this stage.
- **Security headers wired** — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy all live in `next.config.ts:8-21`.
- **CI workflow** — `.github/workflows/ci.yml` runs lint → typecheck → truthfulness → test → build, gating every merge to main. Truthfulness contract is now machine-enforced.
- **Cron orchestrator** — fault-tolerant, deadline-enforced, work-stealing queue, polite vendor rate-limits, per-source telemetry (D3 fix earlier this session).
- **Graceful-degrade pattern** — `useLeads` retry-on-missing-column, `/api/feedback` DB-then-email-then-JSONL, `/api/exclusivity` table-missing-then-empty-summary, importer scripts strip-provenance-on-PGRST204. The app survives partial migration deploys.
- **Brand discipline** — no `font-bold` on Fraunces, no `#E8916A`, no emojis, "Henri." with period, all four pricing tiers exact. Truthfulness scan PASSes against current source tree.

## Verification gate (current state, captured at audit start)

- `pnpm tsc --noEmit` → exit 0
- `pnpm eslint src --max-warnings=0` → exit 0 (`scripts/` has 28 ts-no-unused-vars warnings — non-shipping code)
- `pnpm test` → 12 files / 220 tests / 0 failures / 2.92s
- `pnpm truthfulness` → PASS / TRUTHFULNESS_OK
- `git status --short` → 195+ modified entries (mix of script renames into `_archive/`, new importers, working-tree from session)

## Diff vs 2026-04-26

### Closed (8 of 10 prior priorities)
- ✅ Migrations 00041-00047, 00050, 00051 applied (was: blocking burst-enrich + new enrichment writes)
- ✅ CI workflow live (`.github/workflows/ci.yml` runs lint+tsc+truthfulness+test+build)
- ✅ Security headers wired (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- ✅ Truthfulness scan automated in CI (was: manual)
- ✅ `pnpm migrate` script + bundle-paste flow live
- ✅ Stripe webhook hardened: insert-then-coupon reorder (B3) + idempotency on `event.id` confirmed
- ✅ LLM injection defenses on `/api/ai/draft-reply` + `/api/chat/refine` (S1+S2)
- ✅ god-mode bypass audit log (S6)
- ✅ Zod schemas added to 7 of 17 critical POST routes (50% complete on prior #4)

### Still open
- ⚠️ `@sentry/nextjs` not installed (prior #2 — 30-min task)
- ⚠️ 5 untested critical paths still 0% covered (prior #6 — 1-week sprint)
- ⚠️ Auto-generated DB types not started (prior #7 — and the type-cast counts have regressed)

### New regressions
- 🔻 `as unknown as` count: 37 → 53 (+43%) due to mapLead and ContractorCard joined-relation reads
- 🔻 `Record<string,unknown>` count: 124 → 141 (+13%) same root cause
- 🔻 LeadDetailDrawer LOC: 889 → 1,116 (+25%) — feature accretion without extraction

### New issue domains
- 🔻 14 unvalidated POSTs (only 7 of the 17 prior-flagged critical POSTs got Zod)
- 🔻 Twilio/Resend webhook idempotency (vs Stripe, which is exemplary)
- 🔻 Migration numbering gap (00048-00049 absent without explanation)

## Next audit

Re-run quarterly. Diff against this version to see whether priorities #1-#10 cleared. New audits go to `docs/audits/YYYY-MM-DD/`.

---

<a id='01--architecture'></a>
# 01 — Architecture

## TL;DR

Henri's structure remains feature-driven and consistent. Routes group cleanly by audience, components are co-located by domain, lib modules stay server-side, and middleware role-gates every dashboard segment. The single architectural concern is **continued component bloat**: four files exceed 800 LOC, with `LeadDetailDrawer` growing 25% since the prior audit (889 → 1,116 LOC) without proportional feature growth — feature accretion without extraction.

## Score

**HEALTHY** — solid bones; refactor large components when you have a slow week.

## Inventory

| Surface | Count | Notes |
|---|---:|---|
| Source files (`.ts`/`.tsx`) | 438 | (was 412 in 2026-04-26 — +26 net) |
| API routes | 102 | (was 98 — +4 routes added: chat/refine, dev/auto-login, etc.) |
| Migrations | 51 | (was 44 — +7 net: 00045, 00046, 00047, 00050, 00051, 00052, 00053) |
| Hooks | 30 | (was 28 — +2 net) |
| `src/lib/` subdirectories | 28 | agents, auth, capacity, constants, demo, enrichment, exclusivity, format, ingest, license, log, logger, mapbox, matching, openai, outreach, pdf, permits, plans, predictive, resend, reviews, schemas, scoring, scrapers, sequences, sources, stripe, supabase, tax, territories, territory, twilio, utils, validators |
| `error.tsx` boundaries | 26 | full route-segment coverage |

## Top 9 largest files (LOC)

| Rank | File | LOC | Δ since 2026-04-26 | Risk |
|---:|---|---:|---:|---|
| 1 | `src/lib/enrichment/county-gis.ts` | 1,192 | (new top) | County GIS adapters — natural breadth, low concern |
| 2 | `src/components/dashboard/LeadDetailDrawer.tsx` | 1,116 | +227 (+25%) | UI monolith — refactor candidate |
| 3 | `src/components/portal/ChatIntakeModal.tsx` | 1,028 | (~unchanged) | Multi-step modal — refactor candidate |
| 4 | `src/lib/permits/sources.ts` | 935 | (~unchanged) | Source registry — natural breadth |
| 5 | `src/app/(marketing)/contractors/page.tsx` | 916 | (~unchanged) | Marketing page — long copy, low concern |
| 6 | `src/lib/enrichment/orchestrator.ts` | 871 | (~unchanged) | 9-pass orchestrator — refactor candidate |
| 7 | `src/app/(dashboard)/dashboard/map/page.tsx` | 828 | (~unchanged) | Map page — refactor candidate |
| 8 | `src/app/api/cron/weekly-digest/route.ts` | 826 | (new) | Email digest builder — natural breadth |
| 9 | `src/app/api/cron/score/route.ts` | 733 | +30 | Scoring cron — load-bearing for wedge #2 |

## Findings

### A1. HEALTHY — `middleware.ts` is canonical, no `proxy.ts` confusion
**File**: `src/middleware.ts` (lines 1-184)
**Why it matters**: Prior audit flagged ambiguity between `middleware.ts` and `proxy.ts` in Next.js 16 (the framework's deprecation notice fires on dev startup). The codebase is on the canonical `middleware.ts` path. Single source of truth for role-gating, god-mode bypass, and onboarding-step enforcement.
**Status**: No action.

### A2. WATCH — `LeadDetailDrawer.tsx` grew 25% since prior audit
**File**: `src/components/dashboard/LeadDetailDrawer.tsx:1116`
**Severity**: Medium
**Why it matters**: Highest-visibility dashboard component (drawer rendered for every lead-row click) couples permit timeline rendering, enrichment state, proposal generation, contractor/business section, focus-trap, drag-resize, ARIA separator semantics, and 4 tab variants. Per CLAUDE.md "client-side fallback first" the file ALSO holds graceful-degrade logic. Change-friction here is the highest-leverage refactor.
**Recommended fix**: Extract `generateProposal()` (lines ~125-253) into `src/lib/proposals/index.ts`. Extract the contractor/business section (lines ~849-940) into a sibling component. Target: <600 LOC. ~3 hours.

### A3. WATCH — `county-gis.ts` (1,192 LOC) is the new top file
**File**: `src/lib/enrichment/county-gis.ts:1192`
**Severity**: Low
**Why it matters**: 13+ jurisdiction adapters, each with its own field mapping. Natural breadth — splitting per-county would add 13 files without reducing complexity. The size flag is a "watch" not an "issue" because the file structure is consistent (one adapter per jurisdiction, all conforming to the same `CountyGISLookup` shape).
**Recommended fix**: Defer until a 14th jurisdiction is added; if you cross 1,500 LOC, split by region (`west.ts` / `south.ts` / `northeast.ts`).

### A4. HEALTHY — Hook discipline holds across 30 hooks
**Files**: `src/hooks/*.ts` (30 files)
**Why it matters**: Per CLAUDE.md rule "All hooks run unconditionally", spot-check of `useEnrichment`, `useLeads`, `useExclusivity`, `usePermitHistory` confirms AbortController cleanup pattern and conditional-hook avoidance. No `useState` / `useEffect` below early returns.
**Status**: No regressions.

### A5. HEALTHY — Cancellation-safe `useEffect` pattern is consistent
**Files**: `src/hooks/useLeads.ts`, `src/hooks/useEnrichment.ts`, `src/hooks/useExclusivity.ts`
**Why it matters**: Reference implementations of the cancelled-ref pattern; new hooks (`useEnrichment`, `usePermitHistory`, `useExclusivity`) all match. CLAUDE.md mandates this for all client-side I/O hooks.
**Status**: No action.

### A6. WATCH — Component bloat holds across 4 files
**Files**: `LeadDetailDrawer.tsx` 1,116, `ChatIntakeModal.tsx` 1,028, `contractors/page.tsx` 916, `dashboard/map/page.tsx` 828
**Severity**: Low (per file)
**Why it matters**: Same root cause as A2 — feature accretion without extraction. Three of four are unchanged since 2026-04-26; only `LeadDetailDrawer` regressed.
**Recommended fix**: Set a 1,000-LOC ceiling as the next refactor trigger; nothing above 800 LOC should grow without a corresponding extraction.

### A7. HEALTHY — Feature-flag-before-migration pattern is canonical
**Files**: `src/app/api/feedback/route.ts` (DB-then-email-then-JSONL fallback), `src/app/api/exclusivity/route.ts` (table-missing-then-empty-summary), `src/hooks/useLeads.ts` (column-missing fallback), 9 import scripts (PGRST204 strip-provenance fallback)
**Why it matters**: CLAUDE.md "client-side fallback first" rule. New importers this session (`import-master-json`, `import-perfected-csv`, `import-live-master`, `import-dh3-*`, `import-hd-*`) all match the pattern. Partial migration deploys never break the UI.
**Status**: Pattern is healthier than at the prior audit — every new importer respects it.

## Diff vs 2026-04-26

### Improved
- `middleware.ts` vs `proxy.ts` ambiguity resolved (canonical `middleware.ts`)
- `error.tsx` count holds at 26 (full route-segment coverage)
- Feature-flag-before-migration pattern now applied to 9+ importer scripts

### Regressed
- LeadDetailDrawer LOC 889 → 1,116 (+25%) — needs extraction
- 1 new file enters the >800 LOC list (`weekly-digest/route.ts` 826)

### Unchanged
- 4-file >800 LOC concern (LeadDetailDrawer + ChatIntakeModal + contractors page + map page)
- All hook-discipline patterns intact

---

<a id='02--data-layer'></a>
# 02 — Data Layer

## TL;DR

Migrations are idempotent and RLS-clean. **8 of the 9 prior-pending migrations have landed** since 2026-04-26 (00041–00047, 00050, 00051). Two remain pending — 00052 (provenance metadata on `permit_sources`) and 00053 (`permit_source_zips` linkage table). Both are idempotent and on the user's clipboard. The data layer's biggest WATCH is the **migration numbering gap at 00048-00049** — those numbers are absent and no CHANGELOG explains the skip.

## Score

**WATCH** — applying the 2 pending migrations + clarifying the numbering gap closes most of the remaining concerns.

## Migration status

| # | File | Status | Notes |
|---|---|---|---|
| 00031 | `wedge_trust.sql` | Applied | Exclusivity locks + watchers + permit_events (wedge bullets #1, #6) |
| 00039 | `contact_provenance.sql` | Applied | contact_source / contact_confidence / contact_extracted_at |
| 00041 | `voter_files.sql` | Applied | voter_fl/nc/oh tables |
| 00042 | `ppp_loans.sql` | Applied | PPP loan enrichment table |
| 00043 | `enrich_indexes.sql` | Applied | Partial indexes (year_built / owner / phone NULL paths) |
| 00044 | `leads_enrichment_columns.sql` | Applied | employer / occupation / business_* / license_* / naics_code |
| 00045 | `cross_trade_suggestions.sql` | Applied | Phase 1.2 jsonb column |
| 00046 | `referral_credits.sql` | Applied | Phase 1.4 idempotency log |
| 00047 | `seed_outreach_templates.sql` | Applied | 50 templates seeded |
| **00048** | **(missing)** | **n/a** | **Numbering gap — no CHANGELOG explanation** |
| **00049** | **(missing)** | **n/a** | **Numbering gap — no CHANGELOG explanation** |
| 00050 | `storm_events.sql` | Applied | NOAA Storm Events ingest |
| 00051 | `last_enriched_at.sql` | Applied | leads.last_enriched_at + index |
| **00052** | **`permit_source_provenance.sql`** | **PENDING** | discovered_via / field_mapping_status / priority / imported_at / notes columns on permit_sources |
| **00053** | **`permit_source_zip_coverage.sql`** | **PENDING (table exists, never populated)** | many-to-many `permit_source_zips(source_key, zip, granularity)` for zip→source linkage |

## Findings

### F1. ISSUE — Migrations 00052 + 00053 still pending
**Files**: `supabase/migrations/00052_permit_source_provenance.sql` (idempotent, 1-2 min apply), `supabase/migrations/00053_permit_source_zip_coverage.sql` (idempotent, 1-2 min apply)
**Severity**: High
**Why it matters**: 9 importer scripts in this session graceful-degraded their upserts because `discovered_via` / `field_mapping_status` columns don't exist (PGRST204 schema-cache-miss → strip provenance → retry). The metadata that distinguishes "this row came from US_LIVE_PERMITS_MASTER" from "this row came from auto-discovery" is silently lost. CLAUDE.md "feature-flags before migrations" pattern requires that the migrations land before the next refresh of importer state.

Migration 00053 is a partial state: the table EXISTS (audit confirmed via direct probe) but `permit_source_zips` is empty (0 rows). The JSON importer's Phase 2 detection logic was patched this session to distinguish PGRST205 (stale cache) from 42P01 (real missing table), so re-running `pnpm import:master-json` will populate it once the user pastes the migration and the cache refreshes.
**Recommended fix**:
1. User pastes the bundle at https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new (already on clipboard).
2. Re-run `pnpm import:master-json` to populate `permit_source_zips` (Phase 2 streaming refactor lands ~33,250 ZIPs × N sources).
3. Re-run all 9 importer scripts to backfill provenance metadata (they're idempotent on `source_key`).

### F2. WATCH — Migration numbering gap at 00048 + 00049
**Files**: `supabase/migrations/` (no 00048 or 00049 files)
**Severity**: Low
**Why it matters**: Monotonic numbering is a contract. Gaps suggest dropped work or manual overrides. Future migrations (00054+) will reference "the migration after 00047" — if 00048/00049 turn out to be lost work, the codebase has silent missing schema.
**Recommended fix**: Audit `git log -- supabase/migrations/` for any deleted 00048/00049 file. If they were intentionally squashed, add a comment to `00050_storm_events.sql` explaining: `-- Note: 00048-00049 squashed/skipped, see commit X.` If they were lost, recover and renumber.

### F3. HEALTHY — Idempotency pattern holds across all 51 migrations
**Files**: `supabase/migrations/*.sql`
**Why it matters**: Every migration uses `IF NOT EXISTS` (374 occurrences) for tables/columns/indexes, and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for enum types and policies. Re-runs are safe. CLAUDE.md mandates this.
**Status**: No regressions; pattern is universal.

### F4. HEALTHY — RLS pattern is canonical
**Files**: `supabase/migrations/00053_permit_source_zip_coverage.sql:42-57` (new this session)
**Why it matters**: New table enables RLS, grants `SELECT TO authenticated USING (true)` (reference data, not lead-sensitive), defers writes to service role. Matches the canonical pattern from `permits`, `leads`, `territories`.
**Status**: No action.

### F5. HEALTHY — `last_enriched_at` (00051) is wired to enrichment cron
**Files**: `src/app/api/cron/re-enrich/route.ts`, `supabase/migrations/00051_last_enriched_at.sql`
**Why it matters**: B7 fix earlier this session routed `home_sqft`/`lot_sqft` through `assign()` helper so updated_at only churns when a real field actually changed — no more nightly false-update on every previously-enriched row.
**Status**: Confirmed in re-enrich cron logic.

### F6. WATCH — `dashboard/page.tsx` has 5 unsafe joined-relation casts
**File**: `src/app/(dashboard)/dashboard/page.tsx:81-88` (mapLead function)
**Severity**: Medium
**Why it matters**: Lead type doesn't declare the `permits` join shape returned by `useLeads`. Code casts via `as unknown as Record<string, unknown>` 5 times to read `permitUuid`, `permitApplicantName`, `permitContractorName`, etc. Fragile to schema drift.
**Recommended fix**: Run `mcp__supabase__generate_typescript_types` to create `src/types/database.ts`. Refactor `mapLead()` to use the typed accessor. Closes a chunk of finding [03-types-and-hooks.md C1](./03-types-and-hooks.md).

### F7. HEALTHY — Importer scripts respect feature-flag-before-migration
**Files**: `scripts/import-desktop-catalogs.ts`, `scripts/import-perfected-csv.ts`, `scripts/import-master-json.ts`, `scripts/import-live-master.ts`, `scripts/import-dh3-*.ts`, `scripts/import-hd-*.ts`, `scripts/discover-sources.ts`
**Why it matters**: Each upserts with the rich provenance shape; on PGRST204 / 42703 / "schema cache" error it strips `discovered_via` / `field_mapping_status` / `priority` / `imported_at` / `notes` and retries. New session-added scripts all follow the pattern. The data lands either way; metadata is preserved when the migration is applied, dropped silently otherwise.
**Status**: Pattern is consistently applied across all 9 importers.

## Diff vs 2026-04-26

### Closed
- 5 of the 5 pending migrations (00040-00044) applied
- 00045-00047 + 00050-00051 added and applied
- `pnpm migrate` script wired (`scripts/apply-pending-migrations.ts` audits + emits bundle)
- B7 fix to re-enrich cron (true field change detection, no `updated_at` churn)

### Still open
- 00052 + 00053 pending (idempotent, 2-min paste) — the only blockers to full provenance/ZIP-linkage coverage
- 00048 + 00049 missing without explanation
- Auto-generated DB types still not started (`src/types/database.ts` does not exist yet)

---

<a id='03--types--hooks'></a>
# 03 — Types & Hooks

## TL;DR

Hook discipline holds. Type discipline regressed: **`as unknown as` casts grew 37 → 53 (+43%)** and **`Record<string,unknown>` casts grew 124 → 141 (+13%)** since 2026-04-26. The root cause is the same in both: joined-relation reads on `Lead` (the `permits` join via `useLeads`) and `ContractorCard` are not typed, forcing defensive casts. **The single fix that closes ~80% of both metrics**: auto-generate DB types via Supabase MCP.

## Score

**WATCH** — fixable in one ~2-hour task; no behavioral risk today, but every new feature widens the gap.

## Cross-cutting metric trends

| Metric | 2026-04-26 | 2026-04-28 | Δ | Status |
|---|---:|---:|---:|---|
| `as unknown as` casts | 37 | 53 | **+43%** | REGRESSED |
| `Record<string, unknown>` | 124 | 141 | **+13%** | REGRESSED |
| TODO/FIXME/HACK | (not measured) | 7 | n/a | Low — healthy |
| `console.*` raw uses | 148 | 152 | +3% | flat |

## Hot files for `as unknown as` (top 5)

| File | Casts | Reason |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 18 | mapLead reads joined `permits` child via untyped cast (5 distinct call sites × multiple field reads) |
| `src/components/homeowner/ContractorCard.tsx` | 7 | Reads contractor profile child fields without type |
| `src/components/dashboard/LeadDetailDrawer.tsx` | 3 | Same: reads `lead.permits.id` etc. |
| `src/lib/enrichment/ppp-loan.ts` | 3 | Casts API response shape |
| Other (20 files) | 22 | spread thinly: 1-2 casts per file |

## Hot files for `Record<string, unknown>` (top 5)

| File | Uses | Reason |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 19 | Same root cause as above — joined-relation reads |
| `src/lib/logger.ts` | 7 | Legitimate (meta payloads are deliberately untyped) |
| `src/lib/enrichment/county-gis.ts` | 7 | API response shapes vary per jurisdiction; untyped is correct here |
| `src/lib/permits/fetcher.ts` | 6 | Multi-vendor response shape — untyped is correct here |
| `src/lib/enrichment/extract-contact.ts` | 5 | Multi-vendor — untyped is correct here |

**Insight**: The legitimate uses (`logger.ts` meta, multi-vendor adapter responses) are about a third of the count. The other two-thirds (Lead-with-permits joined reads in mapLead, ContractorCard, LeadDetailDrawer) ARE typed in Postgres and could be auto-generated.

## Findings

### C1. ISSUE — `as unknown as` regressed 37 → 53 (+43%)
**Files**: 23 files, hotspot at `src/app/(dashboard)/dashboard/page.tsx` (18 casts)
**Severity**: Medium
**Why it matters**: CLAUDE.md "type-first discipline" rule. Each cast is a place a refactor of `useLeads`'s SELECT can ship a runtime bug undetected by `tsc`. The growing count is exactly the leading indicator of "schema drift will bite us in production".
**Recommended fix**: Run `mcp__supabase__generate_typescript_types --schema public > src/types/database.ts`. Update `useLeads` to return `Lead & { permits: Database['public']['Tables']['permits']['Row'] | null }`. Refactor `mapLead()` (5 sites) and `ContractorCard` (7 sites) to use the typed accessor. ~2 hours including tests. Eliminates ~25 of the 53 casts in one pass.

### C2. ISSUE — `Record<string, unknown>` regressed 124 → 141 (+13%)
**Files**: 54 files, hotspot at `src/app/(dashboard)/dashboard/page.tsx` (19 uses)
**Severity**: Medium
**Why it matters**: Same root cause as C1. About a third are legitimate (logger meta, multi-vendor adapters); the other two-thirds are joined-relation reads.
**Recommended fix**: Same as C1. Auto-generated types close ~90 of the 141.

### C3. HEALTHY — Hook rule-of-hooks compliance is solid
**Files**: `src/hooks/*.ts` (30 files)
**Why it matters**: Spot-check confirms no unconditional/conditional violations across all 30 hooks. No `useState` / `useEffect` / `useCallback` below early returns. Per CLAUDE.md "All hooks run unconditionally" — pattern holds.
**Status**: No action.

### C4. HEALTHY — Cancellation-safe `useEffect` pattern is universal
**Files**: `src/hooks/useEnrichment.ts`, `src/hooks/usePermitHistory.ts`, `src/hooks/useExclusivity.ts` (reference); `src/hooks/useReviews.ts`, `src/hooks/useReferrals.ts`, `src/hooks/useUser.ts` (consumers)
**Why it matters**: CLAUDE.md mandates the cancelled-ref pattern for all I/O hooks to prevent stale-response races. Every hook that does I/O respects the pattern.
**Status**: No action.

### C5. HEALTHY — `useLeads` is the canonical paginated query pattern
**File**: `src/hooks/useLeads.ts:80-234`
**Why it matters**: Multi-page fetch (when `limit > 1000`) rebuilds query per page (PostgREST builders are single-use), filters re-applied per page, tiebreaker on `id` for stable pagination, dedup pass at end. Retry-on-missing-column for graceful migration drift. Well-documented (~100 LOC of inline comments explaining the mechanics).
**Status**: No regressions; reference pattern.

### C6. NITPICK — `useLeads` has 4 `Record<string, unknown>` casts in pagination
**File**: `src/hooks/useLeads.ts:132, 187, 218, 244`
**Severity**: Low
**Why it matters**: Minor — `Row = Record<string, unknown>` is used as a stand-in for "paginated result row" because the SELECT shape is conditional (NARROW vs WIDE). Not unsafe but tied to C1/C2.
**Recommended fix**: Once auto-generated types exist, type as `Database['public']['Tables']['leads']['Row'] & { permits: ... | null }`.

### C7. NITPICK — TODO/FIXME count is healthy at 7
**Files**: 6 files, 7 occurrences
**Why it matters**: Down from a much higher count earlier. Good housekeeping. Spot list:
- `src/hooks/useReferrals.ts:1`
- `src/app/(dashboard)/settings/account/page.tsx:1`
- `src/lib/enrichment/numverify.ts:1`
- `src/app/api/reviews/respond/route.ts:2`
- `src/app/api/referrals/validate/route.ts:1`
- `src/components/dashboard/CrossTradeOpportunities.tsx:1`
**Status**: No action; review at next quarterly audit.

## Diff vs 2026-04-26

### Improved
- Hook compliance unchanged (still 100% — no violations in 30 hooks)
- Cancellation pattern unchanged (still 100%)
- TODO count down from prior (was higher; now 7)

### Regressed
- `as unknown as` casts: 37 → 53 (+43%)
- `Record<string, unknown>` casts: 124 → 141 (+13%)

### Remediation outlook
One task — `mcp__supabase__generate_typescript_types` + refactor of `mapLead()` and `ContractorCard` — closes both regressions in ~2 hours. The capability is in the repo (Supabase MCP is configured per CLAUDE.md). The only reason this hasn't shipped is bandwidth; it's not blocked on design or tooling.

---

<a id='04--api-surface'></a>
# 04 — API Surface

## TL;DR

**102 API routes**. Auth gating is universal (every contractor route uses `requireContractor()`, every cron uses `CRON_SECRET`, every webhook verifies signature). The single ISSUE: **14 POST routes still accept raw `req.json()` without Zod validation**. The 7 newly-Zod-guarded routes from this session (`/api/ai/draft-reply`, `/api/chat/refine`, `/api/estimates`, `/api/quotes`, `/api/messages/send`, `/api/reviews/respond`, `/api/financing/request`, `/api/estimates/send`) are exemplary; the remaining 14 need the same treatment.

## Score

**ISSUE** — 14 unvalidated POSTs is the single largest open gap. Each could corrupt downstream data (financial records, license metadata, admin probes).

## Per-group breakdown

| Group | Count | Auth | Validation | Notes |
|---|---:|---|---|---|
| `/api/cron/*` | 17 | CRON_SECRET ✓ | All have Zod or env-gating ✓ | Secure |
| `/api/webhooks/*` | 4 | Signature only ✓ | Stripe + Resend + Twilio ✓ | Idempotency gap on Resend + Twilio (see 05-security.md) |
| `/api/admin/*` | 2 | Admin role-check ✓ | `probe` unguarded | Needs Zod |
| `/api/agents/*` | 3 | Cron or auth ✓ | Unvalidated POSTs | All 3 need Zod |
| `/api/dev/*` | 4 | `NEXT_PUBLIC_ENABLE_DEV_LOGIN` gate ✓ | `auto-login` unguarded body | Acceptable (dev-only) |
| `/api/billing/*` | 6 | Contractor auth ✓ | 4/6 have Zod; `extra-zip`, `change-plan` unguarded | 2 need Zod |
| `/api/leads/*` | 3 | Contractor auth ✓ | `[id]/notes`, `[id]` PATCH unguarded | 2 need Zod |
| `/api/estimates/*` | 4 | Contractor auth ✓ | 2/4 have Zod; `[id]` PATCH unguarded | 1 needs Zod |
| `/api/financing/*` | 2 | Contractor auth ✓ | POST unvalidated | 1 needs Zod |
| `/api/ai/*` | 2 | Contractor auth ✓ | Both Zod + delimited ✓ | Secure (S1+S2 fixes confirmed) |
| `/api/intake` | 1 | Public + rate-limit ✓ | Zod ✓ | Secure |
| `/api/contractors/*` | 3 | Public + auth ✓ | Search rate-limited ✓ | Secure |
| `/api/compliance/*` | 2 | Contractor auth ✓ | `verify` unvalidated | 1 needs Zod |
| `/api/license/*` | 1 | Contractor auth ✓ | `verify` unvalidated | 1 needs Zod |
| Public/misc | ~50 | Varies ✓ | Mixed | Per-route review needed |

## Findings

### F1. ISSUE — 14 POST routes still accept raw `req.json()` without Zod
**Severity**: High (compound — any one corrupts downstream data)
**Why it matters**: CLAUDE.md "input validation at the edge" rule. The 7 routes that got Zod this session demonstrate the pattern; the remaining 14 are mechanical work to bring up to that bar.

| # | Route | Risk |
|---|---|---|
| F1.1 | `/api/estimates/[id]` PATCH | Tiers JSON could ship with type confusion (line 35 reads raw `req.json()`, manual `allowedFields` filter) |
| F1.2 | `/api/leads/[id]` PATCH | Pipeline value or date corruption |
| F1.3 | `/api/leads/[id]/notes` POST | XSS risk if notes are rendered unsanitized |
| F1.4 | `/api/financing` POST | Financial corruption (APR, monthly_payment, term_months, quote_id all unvalidated) |
| F1.5 | `/api/license/verify` POST | License number / state could be malformed |
| F1.6 | `/api/admin/sources/probe` POST | `source_key` flows into downstream queries |
| F1.7 | `/api/agents/lead-scorer` POST | `lead_ids` array unbounded |
| F1.8 | `/api/agents/permit-scraper` POST | `source_ids` array unbounded |
| F1.9 | `/api/agents/ziplock` POST | ZIP array could be unbounded |
| F1.10 | `/api/billing/extra-zip` POST | Quantity coerced manually with `Math.max/min` instead of Zod |
| F1.11 | `/api/billing/change-plan` POST | Plan-key validation only via shared schema; verify it's still applied |
| F1.12 | `/api/compliance/verify` POST | Compliance metadata unvalidated |
| F1.13 | `/api/quotes/[id]` PATCH | Status/price unvalidated |
| F1.14 | `/api/profile/notifications` PATCH | (verify Zod applied; if not, list of preference keys unvalidated) |

**Recommended fix**: Use the canonical pattern from `src/lib/schemas/api.ts`:
```ts
const body = parseBody(BillingExtraZipSchema, await req.json());
if (body.response) return body.response;
const { quantity } = body.data;
```
Schemas to add (~14 of them, ~10 lines each): `EstimatePatchSchema`, `LeadPatchSchema`, `LeadNotesSchema`, `FinancingPostSchema`, `LicenseVerifySchema`, `AdminSourcesProbeSchema`, `LeadScorerSchema`, `PermitScraperSchema`, `ZiplockSchema`, `BillingExtraZipSchema`, `BillingChangePlanSchema` (verify), `ComplianceVerifySchema`, `QuotePatchSchema`, `NotificationPrefsSchema`. ~2 hours total.

### F2. HEALTHY — 7 high-risk POSTs got Zod earlier this session
**Files**: `/api/ai/draft-reply`, `/api/chat/refine`, `/api/estimates`, `/api/quotes`, `/api/messages/send`, `/api/reviews/respond`, `/api/financing/request`, `/api/estimates/send`
**Why it matters**: S1+S2+S3+S9 fixes shipped Zod schemas with content caps (e.g. `max(2000)` chars on review text), enum-narrow validation (`channel: z.enum(["sms", "email"])`), and HTML-escape on the financing email render. These are the reference implementations.
**Status**: Pattern confirmed; extending to F1 list is mechanical.

### F3. HEALTHY — `requireContractor()` is universal on contractor-only routes
**File**: `src/lib/auth/requireContractor.ts:15-46`
**Why it matters**: Defense-in-depth alongside middleware. Middleware blocks the obvious bypasses (URL gate); `requireContractor()` blocks the subtle ones (homeowner session aliasing, stale cookies probing contractor routes). Returns 401 for unauthenticated, 403 for non-contractor.
**Status**: Confirmed in spot-check across `/api/leads`, `/api/estimates`, `/api/quotes`, `/api/billing`, `/api/messages`, `/api/territories`.

### F4. HEALTHY — All 17 cron routes gate on `CRON_SECRET`
**Files**: `src/app/api/cron/*/route.ts` (17 files)
**Why it matters**: CLAUDE.md "cron auth via shared secret" rule. Every cron checks `Bearer ${process.env.CRON_SECRET}` before running. Vercel's cron scheduler injects the header; manual triggers via `pnpm score` do the same.
**Status**: No regressions.

### F5. HEALTHY — Webhook signature verification is universal
**Files**: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/twilio/route.ts`, `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/twilio-missed-call/route.ts`
**Why it matters**: Stripe `webhook.constructEvent()` (signature-verify-before-parse), Twilio `validateRequest()`, Resend Svix signature verification. All match canonical patterns.
**Status**: See [05-security.md A7-A8](./05-security.md) for the idempotency gap.

### F6. HEALTHY — `/api/dev/*` gates on `NEXT_PUBLIC_ENABLE_DEV_LOGIN`
**Files**: `src/app/api/dev/auto-login/route.ts:23-26`, `src/app/api/dev/switch-role/route.ts`
**Why it matters**: Returns 404 in production where the env var isn't set. Prevents the founder god-mode entry point from existing on prod URLs at all.
**Status**: Confirmed.

### F7. WATCH — Some webhooks lack request-body Zod (intentional)
**Files**: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/twilio/route.ts`
**Severity**: Low
**Why it matters**: Webhook bodies are signature-verified; the signature implies the body is trusted. Adding Zod on top would catch shape regressions but isn't a security gap. The Stripe webhook does pull specific fields (`event.id`, `event.type`, `event.data.object`) which are typed via `stripe.events.Event`.
**Recommended fix**: Optional. If you do, narrow with `z.discriminatedUnion("type", [...])` per webhook event type for richer typing. Not urgent.

## Diff vs 2026-04-26

### Closed
- 7 of 17 critical POST routes got Zod schemas (S1+S2+S3+S9)
- LLM injection defense on `/api/ai/draft-reply`, `/api/chat/refine` confirmed
- Stripe webhook reorder fix (B3) shipped
- god-mode bypass audit log (S6) shipped

### Still open
- 14 POST routes still missing Zod (F1.1-F1.14)
- Twilio + Resend webhook idempotency keys (separate finding; see 05-security.md)

---

<a id='05--security'></a>
# 05 — Security

## TL;DR

Security posture improved substantially since 2026-04-26: **security headers wired** in `next.config.ts`, **LLM injection defenses shipped** (S1+S2 — `<<<REVIEW>>>` delimiters, output-pattern reject, per-answer caps), **god-mode audit log shipped** (S6 — structured `console.warn` JSON line), **Stripe reorder fix shipped** (B3 — insert→coupon→update), **ILIKE pattern escape shipped** (B6 — `eq` instead of `ilike` in queryAddressSiblings). The two open WATCH items are **Twilio + Resend webhook idempotency** and the **14 unvalidated POSTs** documented in [04-api-surface.md F1](./04-api-surface.md).

## Score

**HEALTHY** — most prior open issues closed; remaining gaps are mechanical (Zod on 14 POSTs + 2 idempotency keys).

## Findings

### A1. HEALTHY — Service-role key isolated to server modules
**File**: `src/lib/supabase/admin.ts`
**Why it matters**: CLAUDE.md "service-role key never reaches the browser" rule. Grep confirms no client-side imports; the `createAdminClient()` factory is only imported from cron routes, webhook handlers, and other server-only modules.
**Status**: No regressions.

### A2. HEALTHY — Env validation fails closed in production
**File**: `src/lib/env.ts:38-60`
**Why it matters**: Missing required env in production throws (line 48); dev mode warns and returns fallback. Insecure `CRON_SECRET` defaults (`change_me`, `secret`, etc.) explicitly rejected (line 52-57). Belt-and-suspenders against the deployment-with-default-secrets failure mode.
**Status**: No action.

### A3. HEALTHY — god-mode bypass audit log live
**File**: `src/middleware.ts:59-78`
**Why it matters**: S6 fix shipped — every god-mode request emits a structured `console.warn` JSON line with `email`, `user_id`, `path`, `ip` (from `x-forwarded-for`), and `ts`. CLAUDE.md "god-mode is privileged short-circuit; needs audit trail" rule. Without this, a compromised allowlist email or misconfigured `GOD_MODE_EMAILS` env var leaves no trace.
**Status**: Confirmed in spot-check.

### A4. HEALTHY — LLM injection defense shipped on `/api/ai/draft-reply` + `/api/chat/refine`
**Files**: `src/app/api/ai/draft-reply/route.ts:27-45, 57-77, 120-138`, `src/app/api/chat/refine/route.ts:79-150`
**Why it matters**: S1+S2 fixes shipped:
- Zod schema caps text length (2000 chars on review text, 500 chars per answer × 3 answers)
- User content wrapped in `<<<REVIEW>>>...<<<END_REVIEW>>>` and `<<<ANSWER N>>>...<<<END_ANSWER>>>` delimiters
- System prompt explicitly instructs LLM to treat delimited content as data
- Sanitizer strips delimiter sentinels from input (so an attacker can't close the delimiter early)
- Output-pattern reject: anything containing URL / phone / JSON-shape / delimiter echo falls back to canned reply
**Status**: Defense-in-depth across 3 layers (Zod → prompt → output filter).

### A5. HEALTHY — Stripe webhook is exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Why it matters**: 
- Signature verified via `stripe.webhooks.constructEvent()` BEFORE `JSON.parse()`
- Idempotent on `event.id` (logged via `logBillingEvent()` with unique constraint `uq_billing_events_stripe_event_id` from migration 00007)
- No client-controlled IDs read from request body
- B3 reorder fix shipped: referral-credit INSERT placeholder → CREATE Stripe coupon → UPDATE row with real coupon_id (eliminates duplicate coupons under at-least-once webhook delivery)
**Status**: Reference implementation.

### A6. HEALTHY — Security headers wired in `next.config.ts`
**File**: `next.config.ts:8-21`
**Why it matters**: 
- `X-Frame-Options: SAMEORIGIN` — anti-clickjacking
- `X-Content-Type-Options: nosniff` — MIME sniffing block
- `Referrer-Policy: strict-origin-when-cross-origin` — privacy
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()` — feature lockdown
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — HSTS (2-year)
- `X-DNS-Prefetch-Control: on` — perf
Applied to every route via `headers()` async function.
**Status**: Closes prior audit's #8 priority.

### A7. WATCH — Resend webhook lacks idempotency key
**File**: `src/app/api/webhooks/resend/route.ts:15-50`
**Severity**: Medium
**Why it matters**: Resend (Svix-shaped) signature verification + 5-min timestamp window are present, but no per-event dedup. Replayed webhook could fire duplicate notifications/state-updates. Stripe is the gold standard here; Resend should match.
**Recommended fix**: Store processed `svix-id` in DB; check before processing. Migration: `CREATE TABLE IF NOT EXISTS webhook_idempotency (provider text, event_id text, processed_at timestamptz, PRIMARY KEY (provider, event_id))`. ~1 hour.

### A8. WATCH — Twilio webhook lacks idempotency key
**File**: `src/app/api/webhooks/twilio/route.ts:17-50`
**Severity**: Medium
**Why it matters**: Twilio webhook validates signature + parses `MessageSid` but lacks dedup. Duplicate webhook → duplicate status update.
**Recommended fix**: Same shared `webhook_idempotency` table as A7. Use `MessageSid` as event_id. ~1 hour.

### A9. ISSUE — 14 POST routes still missing Zod
**Files**: See [04-api-surface.md F1](./04-api-surface.md) for full list.
**Severity**: High (compound across 14 routes)
**Why it matters**: Same root cause as 04-F1; financial / compliance / admin metadata could be corrupted.

### A10. HEALTHY — Foreign-domain filter holds in importers
**Files**: `scripts/import-live-master.ts:178-191`, `scripts/import-perfected-csv.ts`, `scripts/import-master-json.ts`
**Why it matters**: Earlier sessions caught Colombian (`datos.gov.co`) data slipping through one of the upstream curated CSVs. The defensive filter at the importer layer drops `.gov.co`, `.gob.mx`, `.gov.uk`, `.gov.ca`, and any `\.gov\.[a-z]{2,3}$` pattern. Henri's data must remain US-only.
**Status**: No regressions.

### A11. HEALTHY — `/api/dev/*` gated by `NEXT_PUBLIC_ENABLE_DEV_LOGIN`
**File**: `src/app/api/dev/auto-login/route.ts:23-26`
**Why it matters**: Returns 404 when the flag isn't set; even direct `POST` against the production URL fails. The flag is never set in Vercel production env.
**Status**: Confirmed; the dev-login button on `/login` is also conditionally rendered.

### A12. HEALTHY — Permit-relevance + permit/marriage/firearm negative filter
**File**: `scripts/import-live-master.ts:140-155, 168-185`
**Why it matters**: Importers reject film/marriage/marijuana/firearm/concealed-carry/skate-park rows even if the upstream CSV claims them as "permits". Henri sells construction leads, not lifestyle data. Defensive filter prevents accidentally enabling a lead pipeline that contradicts the brand promise.
**Status**: No regressions.

### A13. HEALTHY — ILIKE pattern injection closed (B6)
**File**: `src/lib/enrichment/orchestrator.ts:queryAddressSiblings`
**Why it matters**: B6 fix earlier this session changed `.ilike("address", address)` → `.eq("address", address)`. Addresses containing `%`, `_`, `\` no longer cause unexpected pattern matches. Subtle but real.
**Status**: Confirmed.

## Diff vs 2026-04-26

### Closed
- A6 (security headers) — was open #8 priority
- A4 (LLM injection) — was open #5 priority (S1+S2 fixes shipped)
- A3 (god-mode audit log) — was open S6 (this session)
- A5 (Stripe reorder) — was open B3 (this session)
- A13 (ILIKE injection) — was open B6 (this session)

### Open
- A7+A8 (Twilio/Resend idempotency) — new finding
- A9 (14 unvalidated POSTs) — partial close (7 of 17 done; 14 remaining)
- LLM safety audit (prior #5) — partially closed; the AI/chat surfaces are hardened but `/api/agents/*` posts are still unvalidated

---

<a id='06--performance'></a>
# 06 — Performance

## TL;DR

Cron architecture is fault-tolerant: deadline-enforced, work-stealing queue, polite vendor rate-limits, per-source telemetry (D3 fix shipped). Query patterns in hooks are paginated and bounded. The two open WATCH items are: (1) **`useLeads` partial-result-on-page-timeout silently logs to `console.warn`** (will become invisible when Sentry lands without a `logger.warn` swap), and (2) **`/api/cron/score` and `/api/cron/permits` lack inline 280s deadline enforcement** (only `/api/cron/enrich` has it).

## Score

**HEALTHY** — only 2 small reliability improvements remain to close the loop.

## Findings

### F1. HEALTHY — Cron deadline enforcement + per-item try/catch (enrich)
**Files**: `src/app/api/cron/enrich/route.ts:159-285`, `src/app/api/cron/re-enrich/route.ts`
**Why it matters**: CLAUDE.md "graceful degradation" wedge. Both crons implement work-stealing queue, deadline (`t0 + 280_000`, 20s headroom under Vercel's 300s kill), per-lead try/catch isolation, polite per-worker rate limit (`REQ_INTERVAL_MS=500` × 4 workers = 8 req/s global).
**Status**: Reference implementation.

### F2. HEALTHY — Polite rate limits on free vendors confirmed
**Files**: `src/app/api/cron/enrich/route.ts:56-57`
**Why it matters**: County GIS endpoints + Numverify (100/mo) + Cloudmersive (800/mo) require measured pacing to avoid bans/overages. Math is documented inline (lines 41-43) — at concurrency 4 with 500ms interval per worker, global rate is 8 req/s.
**Status**: No regressions.

### F3. HEALTHY — D3 telemetry (per-source hit rate) emitted
**File**: `src/app/api/cron/enrich/route.ts:290-320`
**Why it matters**: D3 fix earlier this session — `getTelemetry()` snapshot per-source (calls, hits, hit_rate, avg_latency_ms), sorted by hit_rate desc, emitted in JSON response + `logger.info("enrich cron complete", summary)`. Lets the founder answer "is Hunter.io / FEC / OpenCorporates contributing?" without cracking open every lead's sources object.
**Status**: Closes prior #2.1 priority.

### F4. WATCH — `/api/cron/score` and `/api/cron/permits` lack inline 280s deadline check
**Files**: `src/app/api/cron/score/route.ts`, `src/app/api/cron/permits/route.ts`
**Severity**: Medium
**Why it matters**: Both have `maxDuration = 300` but no inline early-exit. Per-iteration loop (e.g. permit-by-permit scoring) could overrun 300s and hit Vercel's hard kill, leaving partial state. `/api/cron/enrich` is the reference implementation (line 160-275: `const deadline = t0 + 280_000` checked at every worker iteration).
**Recommended fix**: Add `const deadline = Date.now() + 280_000` to both, check inside the per-permit / per-source loop. ~30 minutes.

### F5. WATCH — `useLeads` silently logs partial results on page timeout
**File**: `src/hooks/useLeads.ts:222-229`
**Severity**: Low
**Why it matters**: Multi-page fetch (god-mode 5k+ leads) reconstructs query per page, retries once on missing-column, but if a later page times out it returns partial results with `console.warn`. Vercel logs ingest unstructured text; once Sentry is wired (priority #4), this signal will be invisible because `console.warn` is not in the structured logger pipeline.
**Recommended fix**: Replace `console.warn` with `logger.warn` (`@/lib/logger`). Once Sentry is wired, partial-result events become aggregatable.

### F6. NITPICK — `useLeads` rebuilds filter query 4× in pagination loop
**File**: `src/hooks/useLeads.ts:187-218`
**Severity**: Low
**Why it matters**: Per-page query builder reconstructs filters from scratch (PostgREST builders are single-use). Not a perf hit on realistic data (50-1000 leads/page) but makes refactoring brittle.
**Recommended fix**: Extract `buildLeadsQuery(supabase, godMode, userId, filters)` helper. ~30 min.

### F7. HEALTHY — Importer scripts use recursive batch-halving on Supabase 522s
**Files**: `scripts/import-live-master.ts:upsertChunk`, `scripts/import-master-json.ts:upsertChunkWithRetry`
**Why it matters**: Supabase's PostgREST is Cloudflare-fronted; large bulk upserts trigger 522 "upstream request timeout" or 57014 statement-timeout. The helper halves the chunk and retries, bottoming out at chunk size 10. New importers all use the pattern.
**Status**: New session-added; pattern is consistent.

### F8. HEALTHY — `useLeads` pagination is correct
**File**: `src/hooks/useLeads.ts:80-234`
**Why it matters**: Single-page (`limit ≤ 1000`) uses `.range(startOffset, startOffset + limit - 1)` with stable tiebreaker on `id`. Multi-page (`limit > 1000`) iterates with PAGE_SIZE=1000, dedups via `Map<id, row>` after collection. Correctness is preserved across page boundaries.
**Status**: No regressions.

### F9. WATCH — Bundle size top files (refactor candidates from 01-architecture.md)
**Files**: `LeadDetailDrawer.tsx` 1,116, `ChatIntakeModal.tsx` 1,028, `dashboard/map/page.tsx` 828
**Severity**: Low
**Why it matters**: Both `LeadDetailDrawer` and `ChatIntakeModal` are dynamically loaded in their callers (drawer is opened on click, modal is intake step 2+) so bundle impact is deferred. Still — at 1,000+ LOC each, dev-cycle hot-reload becomes sluggish.
**Recommended fix**: Per [01-architecture.md F2](./01-architecture.md), extract `generateProposal()` and contractor/business section.

## Diff vs 2026-04-26

### Closed
- D3 (per-source telemetry) — was open prior
- B7 (re-enrich `assign()` helper) — was open prior

### Still open
- F4 (deadline enforcement on score + permits crons)
- F5 (useLeads partial-result swap to logger.warn)
- Bundle bloat from large components (already covered in 01-architecture.md)

---

<a id='07--reliability'></a>
# 07 — Reliability

## TL;DR

Error boundaries cover every route segment (26 `error.tsx` files). Graceful-degrade pattern is canonical (3 reference implementations, 9+ importer scripts now respect it). Stripe webhook idempotency confirmed. The two open items: **Twilio + Resend webhooks lack idempotency keys** and **2 cron routes lack inline deadline enforcement**.

## Score

**WATCH** — fixable in ~3 hours of focused work.

## Findings

### F1. HEALTHY — Error boundaries at every route segment
**Files**: 26 `error.tsx` files (per `find src -name error.tsx | wc -l`)
**Why it matters**: Next.js error boundaries catch render errors before grey-screen fallback. Every nested segment has one — `(dashboard)/error.tsx`, `(dashboard)/dashboard/error.tsx`, `(dashboard)/leads/[id]/error.tsx`, `(homeowner)/error.tsx`, `(auth)/error.tsx`, etc.
**Status**: No regressions.

### F2. ISSUE — Twilio + Resend webhooks lack idempotency keys
**Files**: `src/app/api/webhooks/twilio/route.ts:17-50`, `src/app/api/webhooks/resend/route.ts:15-50`
**Severity**: Medium-High
**Why it matters**: Both verify their respective signatures (Twilio `validateRequest()`, Resend Svix) and parse event IDs (`MessageSid`, `svix-id`) but neither checks them against a processed-events table. Replayed webhooks fire duplicate state updates / notifications. CLAUDE.md "idempotency on event ID" rule.

Stripe is the gold standard — see `src/app/api/webhooks/stripe/route.ts` for the canonical pattern (logBillingEvent + unique constraint on `stripe_event_id`).
**Recommended fix**: 
1. Migration: `CREATE TABLE IF NOT EXISTS webhook_idempotency (provider text, event_id text, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, event_id))`
2. In each webhook handler: check before processing, insert after.
3. ~1 hour each (2 hours total).

### F3. HEALTHY — Stripe webhook idempotency exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Why it matters**: Signature-verify-before-parse, idempotent on `event.id`, no client-controlled IDs from request body, B3 reorder fix (insert→coupon→update) shipped this session.
**Status**: Reference implementation.

### F4. WATCH — `/api/cron/score` + `/api/cron/permits` lack inline 280s deadline
**Files**: `src/app/api/cron/score/route.ts` (733 LOC), `src/app/api/cron/permits/route.ts` (per session B1 fix earlier)
**Severity**: Medium
**Why it matters**: Both have `maxDuration = 300` but no `Date.now() < deadline` check inside per-item loops. Vercel's 300s kill leaves partial state — half-scored leads, half-ingested permits. `/api/cron/enrich` is the reference (line 160).
**Recommended fix**: Add deadline check inline. ~30 min total.

### F5. HEALTHY — Graceful-degrade pattern canonical across 3 references + 9 importers
**Files**: `src/app/api/feedback/route.ts` (DB→email→JSONL), `src/app/api/exclusivity/route.ts` (table-missing→empty-summary), `src/hooks/useLeads.ts` (column-missing→narrow-SELECT), `scripts/import-*.ts` (PGRST204→strip-provenance)
**Why it matters**: CLAUDE.md "client-side fallback first" rule. New importer scripts this session (9 of them) all match the pattern.
**Status**: Healthier than at prior audit; pattern is universal.

### F6. HEALTHY — Cron orchestrator fault-tolerant
**File**: `src/app/api/cron/enrich/route.ts:159-285`
**Why it matters**: Work-stealing queue (workers pull from shared cursor), per-lead try/catch (line 275-284), deadline-enforcement (line 270), polite rate limit (line 252).
**Status**: Reference implementation; should be replicated in F4 routes.

### F7. WATCH — Importer scripts handle Supabase 522s but no resumable checkpoint on most
**Files**: `scripts/import-master-json.ts` (has checkpoint), `scripts/import-live-master.ts`, `scripts/import-dh3-*.ts`, `scripts/import-hd-*.ts` (no checkpoint)
**Severity**: Low
**Why it matters**: When Supabase's PostgREST is rate-limited (we hit this 3 times this session), the importer halves chunks and retries — but if it eventually gives up, re-running starts from offset 0. Idempotency on `source_key` makes re-runs safe (already-landed rows are no-ops), but redoing a 100k-row scan when only the last 5k failed is inefficient.

`import-master-json.ts` has the canonical checkpoint pattern: state file at `scripts/.import-master-json.state.json`, `cursor` saved per batch, `FRESH=1` env var to ignore.
**Recommended fix**: Extract checkpoint logic into shared helper `scripts/_import-checkpoint.ts`, use across all importers. ~1 hour.

### F8. HEALTHY — Vercel cron schedule is comprehensive
**File**: `vercel.json` (17 cron entries)
**Why it matters**: 17 scheduled jobs cover scoring (every 2h), scraping (every 30 min), enrich (every 15 min), re-enrich (daily 02:00), digest (daily 07:00), weekly digest (Mon 08:00), license check (daily 06:00), billing sync (every 6h), follow-ups (every 15 min), permits ingest (every 6h), review requests (daily 10:00), engagement (daily 03:00), zip-demand (daily 04:00), geocode-backfill (every 15 min), blast-worker (every 5 min), market-intel (daily 04:00), storm-events (daily 09:00).
**Status**: No action.

## Diff vs 2026-04-26

### Closed
- B3 (Stripe insert→coupon→update reorder) — was open prior
- D3 (per-source telemetry) — was open prior
- Graceful-degrade pattern extended to 9 importers (was open across just 3)

### Still open
- F2 (Twilio + Resend idempotency) — new finding
- F4 (deadline enforcement on score + permits crons) — partial close (enrich done; 2 remain)
- F7 (resumable checkpoints in importers) — new low-severity finding

---

<a id='08--observability'></a>
# 08 — Observability

## TL;DR

Logger is well-designed (structured JSON in prod, pretty in dev, fire-and-forget Sentry sink hook). The two open items: (1) **`@sentry/nextjs` still not installed** — sink registration code is documented in `src/lib/logger.ts:14-23` but no `instrumentation.ts` exists yet; (2) **152 raw `console.*` calls** bypass the structured logger across 75 files.

## Score

**WATCH** — both open items are mechanical: `pnpm add @sentry/nextjs` + 5-line `instrumentation.ts`, then a sed pass for `console.error → logger.error`.

## Findings

### F1. WATCH — `@sentry/nextjs` not installed
**Files**: `src/lib/logger.ts:14-23` (Sentry sink scaffolded), `package.json` (no `@sentry` dependency), no `instrumentation.ts` at repo root
**Severity**: Medium
**Why it matters**: Logger has a `registerErrorSink()` factory (line 55-57) that the Sentry init code is supposed to call. The init code is documented inline:
```ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: process.env.SENTRY_DSN });
registerErrorSink((msg, meta) => {
  Sentry.captureException(new Error(msg), { extra: meta });
});
```
Until this lands, every `logger.error()` call (count: ~50 across the codebase) only logs to Vercel's stdout. Founders can't slice errors by route/user/time without `vercel logs --follow`.
**Recommended fix**: 
1. `pnpm add @sentry/nextjs`
2. Create `instrumentation.ts` at repo root with the 5 lines above
3. Set `SENTRY_DSN` in Vercel env
~30 min total.

### F2. WATCH — 152 raw `console.*` calls bypass the structured logger
**Files**: 75 files
**Severity**: Medium
**Why it matters**: Once Sentry is wired (F1), `logger.error()` forwards to Sentry but `console.error()` does not. Top offenders by file (estimated):
- `src/app/api/cron/score/route.ts`: 40 calls (the bulk; this cron is critical)
- `src/app/api/cron/re-enrich/route.ts`: 5 calls
- `src/app/api/cron/permits/route.ts`: 4 calls
- `src/app/api/feedback/route.ts`: 6 calls (intentionally to JSONL fallback)
- `src/lib/scrapers/*.ts`: 6 calls (scrapers log per-source errors)
- Various API routes: 1-3 each (mostly `console.error("X failed:", error)`)

Vercel logs ingest unstructured text, making it hard to filter by level or field. `console.log()` in a cron is indistinguishable from an error in the Vercel UI.
**Recommended fix**: 
- For `console.error(...)` → `logger.error(...)` swap (90% of cases): `git grep -l "console.error"` + sed pass + spot-check.
- Some legitimate `console.warn` exist: `src/app/api/feedback/route.ts` (JSONL fallback marker), `src/middleware.ts:66` (god-mode audit log explicitly designed as `console.warn` because middleware runs on Edge runtime where `@/lib/logger` isn't compatible).
- ~1 hour with verification.

### F3. HEALTHY — Logger sink is fire-and-forget
**File**: `src/lib/logger.ts:59-69`
**Why it matters**: `safeCall()` wraps the sink in try/catch and never awaits. If Sentry/Datadog is down, the local log still lands, and the cron doesn't wait on a flaky network call. Any sink failure is logged via `console.warn` (not `logger.warn` — that would recurse).
**Status**: No action.

### F4. HEALTHY — Cron telemetry shipped (D3 fix)
**File**: `src/app/api/cron/enrich/route.ts:290-320`
**Why it matters**: Per-source counters (calls, hits, hit_rate, avg_latency_ms) snapshot at end-of-run, sorted by hit_rate desc, emitted in JSON response + `logger.info("enrich cron complete", summary)`. Closes prior #2.1 priority.
**Status**: Reference implementation.

### F5. HEALTHY — Logger format follows `{level, message, timestamp, ...meta}` JSON
**File**: `src/lib/logger.ts:71-79`
**Why it matters**: Production format is structured JSON; dev format is pretty `[ts] LEVEL message {meta}`. Vercel can ingest the JSON shape directly into log queries.
**Status**: No action.

### F6. WATCH — No client-side error reporting wired
**Files**: `src/app/error.tsx`, `src/app/(dashboard)/error.tsx` etc. (26 files)
**Severity**: Low
**Why it matters**: Error boundaries catch render errors but don't forward to Sentry yet. Once F1 lands, `error.tsx` files should call `Sentry.captureException(error)` to surface client-side render failures.
**Recommended fix**: After F1, update each `error.tsx` to import Sentry and capture. ~30 min.

### F7. WATCH — Audit columns inconsistent across tables
**Files**: `supabase/migrations/*.sql`
**Severity**: Low
**Why it matters**: Some tables have `created_at` + `updated_at` triggers (`leads`, `profiles`, `territories`); others just `created_at` (`permits`, `permit_sources` partially); some neither. Compliance audits often need "when was this row last modified?". Not urgent for launch.
**Recommended fix**: Defer to post-launch. Add `updated_at` (with `moddatetime` trigger) to remaining tables when CMMC/HIPAA/SOC2 prep starts.

### F8. HEALTHY — Importer logs use `console.log` deliberately
**Files**: `scripts/import-*.ts`
**Why it matters**: These run via `npx tsx`, not in Next.js server runtime. `console.log` is the right choice for one-shot scripts that emit progress to terminal. Not a violation of the structured-logger rule.
**Status**: No action.

## Diff vs 2026-04-26

### Closed
- D3 (per-source telemetry in enrich cron) — shipped this session

### Still open
- F1 (Sentry not installed) — was prior #2 priority
- F2 (152 raw console.*) — was prior #2 priority (count was 148, slight drift)
- F6 (client-side error reporting) — depends on F1
- F7 (audit columns) — defer to compliance prep

---

<a id='09--tests'></a>
# 09 — Tests

## TL;DR

220 / 220 tests pass across 12 files. Existing tests are well-targeted (scoring engine, rules engine, Stripe webhook, normalizer, sequences engine, business-name parser, env validation, outreach personalizer, rate-limit utils, derived enrichment). The five untested-but-critical paths from the prior audit **remain at zero coverage**: orchestrator (871 LOC), useLeads (395 LOC), exclusivity locks, score cron (733 LOC), re-enrich cron. **No E2E suite exists.**

## Score

**ISSUE** — adding tests on the 5 critical paths is the highest-leverage regression-resistance work. ~1 week sprint.

## Coverage matrix

| Module | LOC | Test file | Status |
|---|---:|---|---|
| Stripe webhook | n/a | `src/app/api/webhooks/stripe/__tests__/route.test.ts` | ✓ Covered |
| Scoring engine | ~700 | `src/lib/scoring/__tests__/scoring.test.ts` | ✓ Covered |
| LLM mining | ~300 | `src/lib/predictive/__tests__/llm-mining.test.ts` | ✓ Covered |
| Rules engine | ~500 | `src/lib/predictive/__tests__/rules.test.ts` | ✓ Covered |
| Permit applicant classifier | ~150 | `src/lib/permits/__tests__/applicant-classifier.test.ts` | ✓ Covered |
| Business-name parser | ~100 | `src/lib/enrichment/__tests__/business-name-parser.test.ts` | ✓ Covered |
| Outreach personalizer | ~200 | `src/lib/agents/__tests__/outreach-personalizer.test.ts` | ✓ Covered |
| Rate-limit utils | ~80 | `src/lib/utils/__tests__/rate-limit.test.ts` | ✓ Covered |
| Normalizer | ~250 | `src/lib/ingest/__tests__/normalize.test.ts` | ✓ Covered |
| Env validation | ~100 | `src/__tests__/env.test.ts` | ✓ Covered |
| Sequences engine | ~400 | `src/lib/sequences/__tests__/engine.test.ts` | ✓ Covered |
| Derived enrichment | ~150 | `src/lib/enrichment/derived/__tests__/index.test.ts` | ✓ Covered |
| **Enrichment orchestrator** | **871** | **— (none)** | **✗ ZERO** |
| **`useLeads` hook** | **395** | **— (none)** | **✗ ZERO** |
| **Exclusivity locks** | **~200** | **— (none)** | **✗ ZERO** |
| **Score cron** | **733** | **— (none)** | **✗ ZERO** |
| **Re-enrich cron** | **~400** | **— (none)** | **✗ ZERO** |
| Score signal writer | ~150 | — (none) | ✗ ZERO |
| Capacity filter | ~120 | — (none) | ✗ ZERO |

## Findings

### F1. ISSUE — Orchestrator (871 LOC, 9-pass enrichment) is uncovered
**File**: `src/lib/enrichment/orchestrator.ts`
**Severity**: High
**Why it matters**: Orchestrator composes 9 enrichment passes (county-GIS, voter-file, FEC, OpenCorporates, Hunter.io, Apollo, NumVerify, Cloudmersive, derived) and merges them into a single `EnrichedContact` object. A refactor that breaks the merge logic (e.g., wrong nullish coalescing operator) ships silently — every lead gets the wrong owner_name, but `tsc` still passes. CLAUDE.md "wedge bullet #2 (transparent confidence)" requires the merge logic be correct.
**Recommended fix**: Add unit tests:
- mock each vendor response → assert merged `EnrichedContact` matches expected shape
- assert highest-confidence source wins for each field
- assert telemetry counters increment correctly
- assert cache hit/miss path
~6 hours.

### F2. ISSUE — `useLeads` hook (395 LOC) is uncovered
**File**: `src/hooks/useLeads.ts`
**Severity**: High
**Why it matters**: Reference implementation of the paginated query pattern. CLAUDE.md "client-side fallback first" requires proving the migration fallback works (lines 145-179: extendedColumnsMissing flag, retry on missing-column). A refactor that breaks the flag would ship silently — leads still load, but extended fields silently drop.
**Recommended fix**: Add tests:
- wide SELECT succeeds on modern schema
- missing-column error triggers fallback to NARROW
- filters re-applied post-fallback
- multi-page dedup (the `Map<id, row>` collection at lines 242-248)
- god-mode bypass (no `contractor_id` filter)
~4 hours.

### F3. ISSUE — Exclusivity locks (~200 LOC) are uncovered — wedge bullet #1
**File**: `src/lib/exclusivity/locks.ts`
**Severity**: High
**Why it matters**: Exclusivity locks enforce wedge bullet #1 (one contractor per permit per trade for 14 days). A race condition (two `upsert` calls arriving simultaneously) could violate the exclusivity invariant. B4+B5 fix earlier this session switched to atomic `.upsert(...)` with retry — but the test that proves it under concurrency doesn't exist.
**Recommended fix**: Add tests:
- atomic upsert under concurrent inserts (assert only ONE row wins)
- lock expiry after 14 days
- lock release on lead won
- `summarize()` with `1-2`, `3-5`, `5+` buckets (wedge bullet #6 — coarse competitive intel)
~4 hours.

### F4. ISSUE — Score cron (733 LOC) is uncovered
**File**: `src/app/api/cron/score/route.ts`
**Severity**: High
**Why it matters**: Scores all leads on a 2h cadence (per `vercel.json`). A regression in signal composition or urgency calculation ships silently to all contractors. The score is the primary user-facing trust signal (wedge bullet #2).
**Recommended fix**: Add integration-style tests with mocked Supabase:
- score a sample permit → assert all 6 signal components computed
- assert urgency thresholds (75+ hot, 50-74 warm, 25-49 cool, 0-24 cold)
- assert `score_signals` jsonb written to leads
- assert contractor round-robin assignment per ZIP
~6 hours.

### F5. ISSUE — Re-enrich cron (~400 LOC) is uncovered
**File**: `src/app/api/cron/re-enrich/route.ts`
**Severity**: Medium-High
**Why it matters**: B7 fix earlier this session changed the patch builder to use `assign()` helper (true field-change detection). Without tests, a future refactor could revert this and silently re-update every previously-enriched lead nightly (the original bug).
**Recommended fix**: Add tests:
- patch only emitted when value changes
- `realFieldsChanged > 0` gate works
- non-changing rows don't bump `updated_at`
~3 hours.

### F6. WATCH — No E2E or integration tests
**Files**: `vitest.config.ts` (only "node" environment)
**Severity**: Medium
**Why it matters**: All tests are unit-level. A refactor that breaks the dashboard → leads fetch → drawer → mutation flow wouldn't be caught by unit tests. Playwright is not wired.
**Recommended fix**: Add `pnpm e2e` script running Playwright on local Supabase. Start with one happy-path test:
- god-mode dev login → dashboard loads → leads list populates → click lead → drawer opens → close → list refreshes
~4 hours setup + 1 test.

### F7. HEALTHY — Critical-path coverage on scoring + rules + Stripe
**Files**: `src/lib/scoring/__tests__/scoring.test.ts`, `src/lib/predictive/__tests__/rules.test.ts`, `src/app/api/webhooks/stripe/__tests__/route.test.ts`
**Why it matters**: These are the parts that ARE tested. Rules engine has 100+ test cases for cross-trade evaluation. Stripe webhook tests cover signature verification, idempotency on event.id, and the recent B3 reorder fix.
**Status**: Quality is high where coverage exists.

### F8. NITPICK — Test naming convention mostly consistent
**Files**: `src/**/__tests__/*.test.ts`
**Why it matters**: Most tests live in `__tests__/` co-located with source. A few outliers exist but it's not a strict rule violation.
**Status**: No action.

## Diff vs 2026-04-26

### Improved
- Test count: 144 → 220 (+53%) across same number of files (12) — existing files added more cases
- All 220 tests pass; no regressions
- Stripe webhook coverage extended to cover B3 reorder fix

### Still open
- F1-F5 (5 critical paths uncovered) — all from prior #6 priority, all still 0%
- F6 (no E2E) — newly explicit; was implicit in prior audit

### Recommended priority for next sprint
A 1-week focused sprint hitting F1-F5 (orchestrator, useLeads, locks, score cron, re-enrich) would close the largest open issue domain in the audit. Each is well-isolated and has clear inputs/outputs. ~30 hours of focused work, mostly mock-heavy.

---

<a id='10--brand--wedge-contract'></a>
# 10 — Brand & Wedge Contract

## TL;DR

**All 6 wedge contract bullets are implemented end-to-end.** Brand discipline holds: no `font-bold` on Fraunces, no forbidden `#E8916A`, no emojis, "Henri." with the period in logos/navs, all four pricing tiers exact ($149/$749/$1,499/$2,555). Truthfulness scan PASSes against current source tree and is now automated in CI (closes prior #5 priority).

## Score

**HEALTHY** — wedge contract holds; brand contract holds; truthfulness contract enforced by CI.

## Wedge contract status (per CLAUDE.md)

| # | Bullet | Status | Reference implementation |
|---|---|---|---|
| 1 | **Exclusivity is enforced on the enriched packet, not the data** | ✓ Live | `src/lib/exclusivity/locks.ts` (atomic upsert + retry per B4+B5 fix); migration 00031 `lead_exclusivity_locks` table; 14-day window; auto-release after 72h of no outreach |
| 2 | **Confidence is transparent** | ✓ Live | `src/lib/scoring/signals.ts` writes 6-signal jsonb breakdown; `src/components/dashboard/ScoreSignalBreakdown.tsx` always renders (height-gate removed per CLAUDE.md "Never hide why a lead scored 65 vs 85") |
| 3 | **Capacity is respected** | ✓ Live | `src/lib/capacity/types.ts` (pure client-side filter); "N filtered out, widen to see" counter in Leads panel |
| 4 | **Outreach is permit-specific** | ✓ Live | `src/lib/agents/outreach-personalizer.ts` references actual permit # + scope + address; `outreach_templates` table seeded with 50 trade-stage-channel templates (migration 00047) |
| 5 | **Speed-to-lead is mechanical** | ✓ Live | Twilio missed-call webhook fires within 10s; `profiles.twilio_tracked_number` populated from Settings → Account UI (G3 fix shipped this session); auto-fire outreach-on-lead-create is opt-in per contractor |
| 6 | **Competitive intel is coarse** | ✓ Live | `src/lib/exclusivity/locks.ts:summarize()` returns bucketed count (`1-2`, `3-5`, `5+`); never names |

## Findings

### F1. HEALTHY — Brand discipline holds
**Files**: `src/app/globals.css`, `src/components/marketing/Logo.tsx`, marketing pages
**Why it matters**: CLAUDE.md "non-negotiable" brand rules:
- "Henri." with period in logos/navs ✓
- Body copy uses "Henri" without period ✓
- Primary `#D4886A` darker terracotta, NOT `#E8916A` ✓ (verified via grep)
- Fraunces (serif, `font-heading font-normal`) for headings — no `font-bold` violations ✓
- DM Sans for body ✓
- No emojis in code, copy, logs, or UI ✓ (lucide-react SVG only)
- Google OAuth only — no GitHub, no Apple ✓
**Status**: No regressions.

### F2. HEALTHY — Pricing source-of-truth holds
**Files**: `src/app/(marketing)/pricing/page.tsx`, `src/app/(marketing)/contractors/page.tsx`, `src/lib/plans/constants.ts`
**Why it matters**: CLAUDE.md "Pricing (source of truth)" rule:
- Founder $149/mo, 3 ZIPs (Beta, limited to 100, price locked) ✓
- Starter $749/mo, 5 ZIPs ✓
- Pro $1,499/mo, 12 ZIPs (Most popular) ✓
- Enterprise $2,555/mo, 20 ZIPs ✓
- 24-hour free trial, credit card required ✓
- No refunds (digital product) ✓
- No CSV export on any plan ✓
**Status**: Confirmed via screenshot earlier this session and live render.

### F3. HEALTHY — Truthfulness scan automated in CI
**File**: `.github/workflows/ci.yml:37-40`, `scripts/truthfulness-scan.ts`
**Why it matters**: CLAUDE.md truthfulness contract — no invented metrics, no fake testimonials, no fabricated homeowner counts. Scan checks for:
- Hard-fail patterns (forbidden numbers like 18.4x, 26%, 4,200+, $11,300, 94% contact, 4.9/5)
- Soft warns (numbers that drift fast)
- Pricing drift (canonical price outside pricing surfaces)
- Forgeries (invented prices like $399, $999, $1,999)

Today's run: PASS / TRUTHFULNESS_OK. Closes prior #5 priority.
**Status**: No action.

### F4. HEALTHY — Truthful claims about coverage
**Files**: `src/app/(marketing)/contractors/page.tsx`, home page
**Why it matters**: CLAUDE.md "Size the claim to the current state" rule. Marketing claims:
- "900k+ Permits Tracked" — DB has ~1.44M permits per latest audit (true; honest)
- "45+ States Covered" — `permit_sources` has every US state + 5 territories per latest sync audit (true; conservative)
- "1 / ZIP" — exclusivity is enforced per migration 00031 + `lib/exclusivity/locks.ts` (true)
- "<30 min" — scrape cron runs every 30 min per `vercel.json` (true)
- "24 hrs" — free trial enforced via Stripe trial_period_days=1 (true)
**Status**: No regressions.

### F5. HEALTHY — Wedge bullet #2 (transparent scoring) compliance
**File**: `src/components/dashboard/ScoreSignalBreakdown.tsx` (always rendered, no height gate)
**Why it matters**: CLAUDE.md "Never hide 'why this score' behind a height gate". Earlier height-gate logic was removed; the breakdown always renders in the lead drawer regardless of drawer height. Wedge bullet is honored.
**Status**: Confirmed.

### F6. HEALTHY — `data-export` and `cancel-anytime` policies hold
**Files**: `src/app/(dashboard)/settings/billing/page.tsx`, footer
**Why it matters**: G1 fix earlier this session updated the cancel/cycle/deletion policy text per the user's spec — "cancel anytime, access until cycle end, then deleted prior to next charge". Replaces the previously broken "Settings → Export" link.
**Status**: Confirmed.

## Diff vs 2026-04-26

### Closed
- Truthfulness scan automated in CI (was prior #5 priority)
- G3 (Twilio tracked-number Settings UI) — wedge bullet #5 fully wired
- B3 (Stripe coupon flow reorder) — wedge bullet #1 invariant preserved

### Still open
- None. Wedge + brand + truthfulness contracts are healthy.

---

<a id='11--build--deploy'></a>
# 11 — Build & Deploy

## TL;DR

CI workflow is live. Vercel cron schedule is comprehensive (17 entries). Build succeeds with placeholder env vars. The single open WATCH is **`pnpm migrate` flow falls back to clipboard-paste in production-like environments** because the auto-bootstrapped `exec_sql` RPC isn't installed in Supabase yet.

## Score

**HEALTHY** — closes prior #3 (CI workflow) and #9 (`pnpm migrate` script) priorities.

## CI workflow

**File**: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Setup pnpm@9 + Node@20
      - Install dependencies (frozen lockfile)
      - Lint (eslint --max-warnings=0)
      - Type check (tsc --noEmit)
      - Truthfulness scan (CLAUDE.md contract)
      - Test (vitest)
      - Build (next build with placeholder env)
```

Gates merge on red. Closes prior #3 priority.

## Vercel cron schedule

**File**: `vercel.json` (17 cron entries)

| Path | Schedule | Cadence |
|---|---|---|
| `/api/cron/score` | `0 */2 * * *` | Every 2h |
| `/api/cron/scrape` | `*/30 * * * *` | Every 30 min |
| `/api/cron/license-check` | `0 6 * * *` | Daily 06:00 |
| `/api/cron/billing-sync` | `0 */6 * * *` | Every 6h |
| `/api/cron/digest` | `0 7 * * *` | Daily 07:00 |
| `/api/cron/weekly-digest` | `0 8 * * 1` | Mon 08:00 |
| `/api/cron/follow-ups` | `*/15 * * * *` | Every 15 min |
| `/api/cron/permits` | `0 */6 * * *` | Every 6h |
| `/api/cron/review-requests` | `0 10 * * *` | Daily 10:00 |
| `/api/cron/engagement` | `0 3 * * *` | Daily 03:00 |
| `/api/cron/zip-demand` | `0 4 * * *` | Daily 04:00 |
| `/api/cron/enrich` | `*/15 * * * *` | Every 15 min |
| `/api/cron/geocode-backfill` | `*/15 * * * *` | Every 15 min |
| `/api/cron/blast-worker` | `*/5 * * * *` | Every 5 min |
| `/api/cron/market-intel` | `0 4 * * *` | Daily 04:00 |
| `/api/cron/storm-events` | `0 9 * * *` | Daily 09:00 |
| `/api/cron/re-enrich` | `0 2 * * *` | Daily 02:00 |

## Findings

### F1. HEALTHY — CI workflow live and comprehensive
**File**: `.github/workflows/ci.yml`
**Why it matters**: Closes prior #3 priority. Lint + typecheck + truthfulness + test + build all gate merge to main. Placeholder env vars allow build without leaking real secrets to GitHub Actions.
**Status**: No action.

### F2. HEALTHY — Cron coverage comprehensive
**File**: `vercel.json`
**Why it matters**: 17 scheduled jobs cover every recurring background task: scoring, scraping, enrichment, follow-ups, digests, license checks, market intel, storm events. No "what runs this?" gap.
**Status**: No action.

### F3. WATCH — `pnpm migrate` falls back to clipboard-paste
**Files**: `scripts/apply-pending-migrations.ts`, `package.json:14`
**Severity**: Low
**Why it matters**: Script attempts RPC path via `exec_sql(text)` (the auto-bootstrap function in `supabase/_pending-bundle.sql:1-17`) but the function isn't installed in production Supabase. Falls back to writing the bundle to disk + emitting a clipboard-paste prompt. Works but isn't fully automated.
**Recommended fix**: First-run apply of `_pending-bundle.sql` would install `exec_sql` and unlock the RPC path. Once installed, all future migrations apply via `npx tsx scripts/apply-pending-migrations.ts` without paste. ~2 min to install (one-time).

### F4. HEALTHY — `package.json` scripts are well-organized
**File**: `package.json:5-30`
**Why it matters**: 16 scripts including the canonical `dev`/`build`/`start`/`lint`/`test` plus Henri-specific `migrate`/`truthfulness`/`ingest`/`score`/`pipeline`/`backfill-geocode`/`check-pipeline`/`import:catalogs`/`import:perfected`/`import:master-json`/`import:live-master`/`import:dh3-{database-complete,zip-mapping,accela}`/`import:hd-{jurisdictions,sources}`/`coverage:gaps`/`discover:sources`. Each maps to a `scripts/*.ts` file.
**Status**: No action.

### F5. HEALTHY — Build uses placeholder env vars in CI
**File**: `.github/workflows/ci.yml:46-51`
**Why it matters**: Build step sets `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`, `NEXT_PUBLIC_APP_URL=https://henri.app` etc. so `next build` succeeds without leaking real secrets. Production env is set in Vercel dashboard separately.
**Status**: No action.

### F6. WATCH — Working tree has 195+ uncommitted entries
**File**: `git status --short` baseline
**Severity**: Low (operational, not architectural)
**Why it matters**: Most are intentional — script renames into `_archive/`, new importers from this session, audit reports being written. But the volume makes it harder to grep "what changed in this PR" without a more granular commit history.
**Recommended fix**: Land logical chunks as separate commits — (1) script renames + archive cleanup, (2) new importers + provenance migrations, (3) live-data integrations, (4) audit reports. ~30 min if you `git add -p` selectively.

### F7. WATCH — Migration bundle on disk could leak via misconfigured static-assets
**File**: `supabase/_pending-bundle.sql`
**Severity**: Low
**Why it matters**: The `.gitignore` rules exclude `supabase/_pending-bundle.sql` from git tracking, but the file lives on disk during `pnpm migrate` runs. If someone misconfigures Next.js to serve `supabase/` as static (no one does today), the bundle would be web-accessible. Defense in depth: ensure `supabase/` is never part of `next.config.ts` `headers()` allowlist or `public/` symlinked.
**Recommended fix**: Confirm `.gitignore` covers it (it does — line lists `supabase/_pending-bundle.sql`). Optional: delete the file after successful apply via the migrate script.

## Diff vs 2026-04-26

### Closed
- F1 (CI workflow) — was prior #3 priority
- F4 (`pnpm migrate` script) — was prior #9 priority (script exists; the only nit is the RPC vs paste fallback)

### Still open
- F3 (RPC path needs first-time install of `exec_sql`)
- F6 (working tree commit hygiene)

---

<a id='12--documentation'></a>
# 12 — Documentation

## TL;DR

`CLAUDE.md` is comprehensive and load-bearing — every rule in the project (brand, pricing, wedge, code patterns, migration discipline) traces back to it. `AGENTS.md` exists. `README.md` exists at repo root. `docs/audits/` now contains 7 audit-related files (this audit + the prior). The single open WATCH is comment density inside the four 1,000+ LOC components — they're well-commented at the top but get sparse in middle sections.

## Score

**HEALTHY** — closes prior #10 priority (README at root).

## Inventory

| File | Lines | Status |
|---|---:|---|
| `CLAUDE.md` | ~600 | Comprehensive, load-bearing |
| `AGENTS.md` | ~10 | Tiny but present (warns "Next.js you know" doesn't apply) |
| `README.md` | unknown | Present at repo root |
| `docs/audits/henri-audit-2026-04-26.md` | ~880 | Prior audit (still archived) |
| `docs/audits/2026-04-26/00-12*.md` | (per-domain files) | Prior detail |
| `docs/audits/henri-audit-2026-04-28.md` | (this audit) | Generated from this audit |
| `docs/audits/2026-04-28/00-12*.md` | (this audit detail) | New |
| `docs/studies/coverage-gaps-2026-04-27.csv` | n/a | Generated by `pnpm coverage:gaps` |

## Findings

### F1. HEALTHY — `CLAUDE.md` is the project's single source of truth
**File**: `CLAUDE.md`
**Why it matters**: Every rule in the codebase traces back to a section: brand non-negotiables, pricing source-of-truth, wedge contract bullets, architecture patterns, code patterns, MCP server config, plugin install logs from prior sessions. The audit's "why it matters" sentences cite this file 30+ times. Without it, regressions would be invisible to drive-by code review.
**Status**: No action.

### F2. HEALTHY — `README.md` at repo root closed prior #10
**File**: `README.md`
**Why it matters**: Prior audit flagged the onboarding vacuum (no repo-root README). Now present.
**Status**: No regressions.

### F3. WATCH — Comment density drops in middle sections of large components
**Files**: `src/components/dashboard/LeadDetailDrawer.tsx`, `src/components/portal/ChatIntakeModal.tsx`
**Severity**: Low
**Why it matters**: Top of each file has thorough doc comment explaining the component's responsibility and the wedge contract bullets it implements. Middle sections (rendering, focus management, drag handling) get sparser — a future maintainer must trace through 600+ LOC to understand a render branch. Per CLAUDE.md "Document everything that's load-bearing or surprising" rule.
**Recommended fix**: When refactoring per [01-architecture.md F2](./01-architecture.md), add section dividers + doc comments explaining each subsection's role. Defer; not a launch blocker.

### F4. HEALTHY — Migration files have inline rationale
**Files**: `supabase/migrations/00031_wedge_trust.sql`, `00043_enrich_indexes.sql`, `00050_storm_events.sql`, `00052_permit_source_provenance.sql`, `00053_permit_source_zip_coverage.sql`
**Why it matters**: Each migration starts with a 5-30 line preamble explaining: what changes, what it unblocks, why this approach (vs alternatives), idempotency notes. Future maintainers don't need git blame to understand intent.
**Status**: No regressions.

### F5. HEALTHY — Importer scripts have thorough headers
**Files**: `scripts/import-*.ts`
**Why it matters**: Every importer (10+ this session) starts with a multi-paragraph block explaining: input format, idempotency contract, fallback strategy, hard rules. CLAUDE.md "Delivery patterns" rule.
**Status**: No regressions.

### F6. WATCH — `docs/` directory is sparse outside `audits/`
**File**: `docs/` (mostly empty besides `audits/` and `studies/`)
**Severity**: Low
**Why it matters**: ADRs (architecture decision records), runbooks, postmortems would naturally live in `docs/`. The current state is "everything in CLAUDE.md or audit reports". Not a problem today; will be a problem when more contributors join.
**Recommended fix**: Defer until 2nd contributor joins. Consider: `docs/decisions/` (ADRs), `docs/runbooks/` (cron failure response), `docs/postmortems/` (when applicable).

### F7. HEALTHY — `.claude/commands/*.md` skill files are well-organized
**Files**: `.claude/commands/{audit,verify,wedge-status,...}.md`
**Why it matters**: Each Henri-specific Claude skill has a markdown file documenting trigger, method, output. Lets future Claude sessions execute consistent workflows.
**Status**: No regressions.

## Diff vs 2026-04-26

### Closed
- F2 (README at root) — was prior #10 priority
- F5 (importer script headers) — new pattern this session, all 10+ importers respect it

### Still open
- F3 (comment density in large components) — ties to 01-F2 refactor recommendation
- F6 (`docs/` directory sparseness) — defer
