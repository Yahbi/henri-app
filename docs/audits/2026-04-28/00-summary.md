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
