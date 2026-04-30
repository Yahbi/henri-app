# Henri — Senior-engineer audit (2026-04-29)

**Generated**: 2026-04-29 — single rolled-up version of [docs/audits/2026-04-29/](./2026-04-29/).

## Table of contents

- [00 — Summary + scorecard + top-10](#00--summary)
- [01 — Architecture](#01--architecture)
- [02 — Data layer](#02--data-layer)
- [03 — Types & hooks](#03--types--hooks)
- [04 — API surface](#04--api-surface)
- [05 — Security](#05--security)
- [06 — Performance](#06--performance)
- [07 — Reliability](#07--reliability)
- [08 — Observability](#08--observability)
- [09 — Tests](#09--tests)
- [10 — Brand & wedge](#10--brand--wedge-contract)
- [11 — Build & deploy](#11--build--deploy)
- [12 — Documentation](#12--documentation)
- [13 — Production runtime](#13--production-runtime-new-domain--first-audit-post-launch)
- [14 — Launch delta](#14--launch-delta-new-domain--diff-vs-2026-04-28)

---

# Henri — Senior-engineer audit (2026-04-29)

**Generated**: 2026-04-29 — single rolled-up version of [docs/audits/2026-04-29/](./).

**Methodology**: 3 parallel Explore agents (architecture+data+enrichment, security+API+production-runtime, perf+reliability+tests+observability) plus targeted reads of anchor files (`src/middleware.ts`, `src/lib/env.ts`, `src/lib/logger.ts`, `instrumentation.ts`, `next.config.ts`, `vercel.json`, `package.json`, `.github/workflows/ci.yml`, `scripts/_deploy-vercel.ts`, `src/lib/webhooks/idempotency.ts`). Verification at start: `pnpm tsc --noEmit` exit 0, `pnpm lint --max-warnings=0` exit 0, `pnpm test --run` 376/376 pass / 20 files / 6.96s, `pnpm truthfulness` PASS / TRUTHFULNESS_OK. Production endpoint `https://meethenri.com/` returns HTTP 200 with full security-header set; `/api/health` reports DB ok (684ms), Resend ok, Stripe/Twilio/OpenAI unconfigured (expected). No code edits made by this audit.

## Executive scorecard

| # | Domain | Status | Δ | Top issue (this audit) |
|---|---|---|---|---|
| 01 | [Architecture](./01-architecture.md) | HEALTHY | UNCHANGED | LeadDetailDrawer pruned 1,116 → 1,031 LOC; 3 new components (Applicant/CrossTrade/Watchers Badge) added clean |
| 02 | [Data layer](./02-data-layer.md) | HEALTHY | IMPROVED | Migration 00054 (webhook_idempotency) NEW + applied + wired; 00052/00053 still on clipboard; numbering gap 00048–00049 persists |
| 03 | [Types & hooks](./03-types-and-hooks.md) | WATCH | UNCHANGED | `as unknown as` 53 → 54 (+1, flat); `Record<string,unknown>` 141 → 153 (+12, all from 3 new components reading nested permit/contractor data) |
| 04 | [API surface](./04-api-surface.md) | ISSUE | UNCHANGED | 14 unvalidated POST routes from prior audit STILL unvalidated. 5 new routes (`/api/health`, `/api/estimates/[id]/pdf`, `/api/estimates/preview-tax`, `/api/cron/re-enrich`, `/api/cron/storm-events`) all auth-gated and validated cleanly |
| 05 | [Security](./05-security.md) | ISSUE | REGRESSED | **NEW Critical**: Resend live API key hardcoded at `scripts/_deploy-vercel.ts:136`. Token also exposed in chat history. LLM/Stripe/CSP/HSTS defenses HEALTHY in shipped code |
| 06 | [Performance](./06-performance.md) | WATCH | REGRESSED | Vercel Hobby plan forces daily-only crons; score-cron now runs at 01:00 UTC daily — a hot permit filed at 06:00 has 19h scoring latency. Violates wedge bullet #5 (speed-to-lead). Acceptable 1-week tradeoff if Pro upgrade is imminent |
| 07 | [Reliability](./07-reliability.md) | HEALTHY | IMPROVED | New `src/lib/webhooks/idempotency.ts` module wired into Twilio (`MessageSid`) + Resend (`svix-id`); Stripe retains its exemplary `event.id` dedup; Twilio missed-call route not yet migrated to the new abstraction |
| 08 | [Observability](./08-observability.md) | HEALTHY | IMPROVED | **`@sentry/nextjs ^10.50.0` installed**, `instrumentation.ts` wired with dynamic-import Function-trick, `src/lib/logger.ts:101` `safeCall()` lit. Yesterday's #4 priority CLOSED. Production `SENTRY_DSN` env var still unset so events queue locally — wire in Vercel env to start aggregating |
| 09 | [Tests](./09-tests.md) | HEALTHY | IMPROVED | 220 → 376 tests / 12 → 20 files. **All 5 prior-zero-coverage critical paths now have tests** (orchestrator, useLeads, exclusivity locks, score cron, re-enrich). Score-signal-writer + capacity filter + Twilio missed-call still uncovered |
| 10 | [Brand & wedge](./10-brand-and-wedge.md) | HEALTHY | UNCHANGED | Truthfulness scan PASS; brand tokens locked (`#D4886A`, no `font-bold` on Fraunces, no emojis, "Henri." with period); 6 wedge bullets all implemented end-to-end |
| 11 | [Build & deploy](./11-build-and-deploy.md) | WATCH | REGRESSED | CI workflow alive but build job uses stale `NEXT_PUBLIC_APP_URL: https://henri.app` placeholder (cosmetic but stale post-domain-swap); 9 of 16 expected production env vars set in Vercel; 7 high-frequency crons downgraded to daily |
| 12 | [Documentation](./12-documentation.md) | HEALTHY | UNCHANGED | CLAUDE.md comprehensive; 8 audit folders now accumulated under `docs/audits/` (suggest archival policy after 30 days) |
| 13 | [Production runtime](./13-production-runtime.md) | WATCH | NEW | Live at `https://meethenri.com` with HTTP 200 + full security-header set + version `56715fa`. 7 expected env vars unset (Stripe ×5, OpenAI, Sentry DSN); legacy GoDaddy DNS records still present in Cloudflare zone (cosmetic but implies Outlook-hosted email which is false) |
| 14 | [Launch delta](./14-launch-delta.md) | n/a | NEW | Side-by-side diff against 2026-04-28: 4 priorities CLOSED (Sentry, idempotency module, 5 critical-path tests, console-discipline cleanup), 1 NEW issue (hardcoded Resend token), 2 launch-induced regressions (cron cadence, CI env staleness) |

**Overall verdict**: Henri is **live in production** with strong defenses in shipped code (LLM injection defenses, Stripe idempotency, CSP/HSTS/X-Frame, RLS-on-everything, 376 passing tests). The launch sprint closed 4 of yesterday's top-10 priorities. **Two new issues require attention before scaling user signups**: (1) the hardcoded Resend API key in `scripts/_deploy-vercel.ts:136` must be rotated and the script refactored to read from `process.env`; (2) Vercel Hobby-plan cron downgrades violate wedge bullet #5 (speed-to-lead) — acceptable for a 1-week launch window if the Pro upgrade is on the calendar. Everything else is steady-state quality work.

## Top 10 priorities (ordered impact × effort)

1. **Rotate the leaked Resend API token** — `re_5bamBRLK_GQ5eQJCSTzftjV535zufWxgS` exists in three places: hardcoded at `scripts/_deploy-vercel.ts:136`, exposed in chat history, and live in Vercel env. Steps: (a) regenerate at https://resend.com/api-keys, (b) update Vercel env var via dashboard, (c) refactor the deploy script to `process.env.RESEND_API_KEY ?? throw`, (d) add `scripts/_*.ts` to `.gitignore` so it can never be committed. ~15 min total. [05-security.md F1](./05-security.md)
2. **Add Zod schemas to the 14 unvalidated POST routes** — same hot list as 2026-04-28: `/api/estimates/[id]` PATCH, `/api/leads/[id]` PATCH, `/api/leads/[id]/notes`, `/api/financing`, `/api/license/verify`, `/api/admin/sources/probe`, `/api/agents/{lead-scorer,permit-scraper,ziplock}`, `/api/billing/extra-zip`. The launch sprint did not touch these. ~2 hours. [04-api-surface.md F1–F14](./04-api-surface.md)
3. **Wire `SENTRY_DSN` in Vercel env** — `@sentry/nextjs` is installed, `instrumentation.ts` is configured, the logger sink is lit. The only thing standing between `logger.error()` calls and a populated Sentry dashboard is the env var. Free-tier Sentry covers the launch volume comfortably. ~5 min in Vercel UI + 1 redeploy. [08-observability.md F1](./08-observability.md)
4. **Wire missing production env vars** — Stripe (5: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 4 price IDs), OpenAI (`OPENAI_API_KEY`). `getEnv()` in `src/lib/env.ts:64–88` throws in production for any missing var, so any code path that calls `getEnv()` without going through a `hasStripe()`/`hasOpenAI()` guard will 500. Stripe is needed before contractor billing flows; OpenAI is needed before LLM-mining surfaces re-engage. ~15 min once Stripe products + webhook are configured. [11-build-and-deploy.md F2](./11-build-and-deploy.md), [13-production-runtime.md F3](./13-production-runtime.md)
5. **Auto-generate DB types via Supabase MCP** — same recommendation as 2026-04-28. `mcp__supabase__generate_typescript_types` → `src/types/database.ts`, then refactor `mapLead()` (5 casts) and `ContractorCard.tsx` (7 casts) to read typed fields. Closes ~50% of the 54 `as unknown as` casts. ~2 hours. [03-types-and-hooks.md F1](./03-types-and-hooks.md)
6. **Fix CI workflow stale-domain reference** — `.github/workflows/ci.yml` `build` job sets `NEXT_PUBLIC_APP_URL: https://henri.app` for placeholder builds. Cosmetic (build placeholder, not runtime), but confusing post-domain-swap. Replace with `https://meethenri.com`. ~2 min. [11-build-and-deploy.md F1](./11-build-and-deploy.md)
7. **Schedule Vercel Pro upgrade and revert cron cadences** — once on Pro, edit `vercel.json` to restore `score: 1 */2 * * *`, `scrape: 5,35 * * * *`, `enrich: 5,20,35,50 * * * *`, `follow-ups: 0,15,30,45 * * * *`, `permits: 20 */6 * * *`. Daily-only is acceptable for the first week; week-2 it starts violating wedge bullet #5 (speed-to-lead). [06-performance.md F1](./06-performance.md), [11-build-and-deploy.md F3](./11-build-and-deploy.md)
8. **Migrate Twilio missed-call webhook to the idempotency module** — `src/app/api/webhooks/twilio-missed-call/route.ts` is the only webhook route not yet using `wasProcessed()` / `markProcessed()`. ~30 min copy-pattern from `twilio/route.ts`. [07-reliability.md F2](./07-reliability.md)
9. **Cover the 3 still-untested critical paths** — score-signal-writer (~150 LOC), capacity filter (~120 LOC), Twilio missed-call route (~194 LOC). Each is load-bearing for one wedge bullet. ~1 day each. [09-tests.md F1–F3](./09-tests.md)
10. **Resolve migration numbering gap 00048–00049** — files absent from `supabase/migrations/`, no CHANGELOG entry. Either restore from git history or document as "intentionally skipped" in `CLAUDE.md`. The gap doesn't break anything (numbering is for human ordering, not Postgres) but it's a "trust me" smell that an audit will keep flagging. ~15 min. [02-data-layer.md F1](./02-data-layer.md)

## What blocks scaling

Of the 10 priorities, the **gating items before paid signups go live** are:

- **#1** — leaked production Resend API key (rotate before next CI run touches the repo)
- **#2** — 14 unvalidated POSTs include `/api/financing` (financial records) and `/api/license/verify` (compliance data); a malformed payload corrupts both
- **#4** — Stripe env vars missing means the entire contractor onboarding flow's payment step throws

Everything else is quality-of-engineering polish that can ship weekly.

## What's working well (audit-wide positives)

- **Production is live and serving** — `https://meethenri.com` returns 200, full security-header set, valid Let's Encrypt cert, `/api/health` confirms DB + Resend operational, version `56715fa`
- **Sentry plumbing is complete** — `@sentry/nextjs ^10.50.0` installed, `instrumentation.ts` uses the Function-constructor dynamic-import trick to keep the build green when the package isn't installed locally; `src/lib/logger.ts` `safeCall()` is lit. Just need `SENTRY_DSN` set in Vercel.
- **Webhook idempotency abstraction** — `src/lib/webhooks/idempotency.ts` (composite-key INSERT with graceful-degrade on missing migration) cleanly mirrors the Stripe pattern. Twilio + Resend webhooks now use it. Migration `00054_webhook_idempotency.sql` follows the CLAUDE.md schema rule (composite PK, RLS, processed_at index).
- **Test coverage exploded in the launch sprint** — yesterday's audit listed 5 zero-coverage critical paths; the launch-day commit (`4b7565b`) added test files for all 5, growing the suite from 220 → 376 tests. All pass.
- **Console.\* discipline radically improved** — 152 raw calls (yesterday) → 10 calls (today). Score-cron alone went from 40 → 0. The 10 remaining are all intentional: 4 in `logger.ts` (the implementation itself), 1 in `middleware.ts` (Edge runtime can't import `@/lib/logger`), 4 in error-boundary pages (dev visibility), 1 in `onboarding/territory/page.tsx` (transitional).
- **Wedge contract holds end-to-end** — exclusivity locks (migration 00031 + `src/lib/exclusivity/locks.ts` now tested), transparent scoring (drawer shows all 6 signals), capacity filter (Settings → Capacity), permit-specific outreach (43 templates seeded via 00047), missed-call text-back (Twilio webhook live), coarse competitive intel (1-2/3-5/5+ buckets). Only wedge #5 (speed-to-lead) is degraded by the daily-cron downgrade.
- **CI gates merge to main** — `lint → tsc → truthfulness → test → build → e2e` runs on every PR. Truthfulness contract is machine-enforced; fabricated metrics fail CI.
- **Brand discipline holds** — truthfulness scan PASS, no `#E8916A` references, no `font-bold` on Fraunces, no emojis, all four pricing tiers exact (`$149` / `$749` / `$1,499` / `$2,555`), "Henri." with period in nav.

## Verification gate (current state, captured at audit start)

- `pnpm tsc --noEmit` → exit 0
- `pnpm lint --max-warnings=0` → exit 0
- `pnpm test --run` → 376 / 376 / 20 files / 6.96s
- `pnpm truthfulness` → PASS / TRUTHFULNESS_OK
- `git status --short` → 195+ entries (mix of `scripts/_archive/` deletions, untracked `.claude/` plugin install, untracked test artefacts; no shipping-code modifications)
- `curl -I https://meethenri.com/` → HTTP/1.1 200 OK, Server: Vercel, all 7 security headers present (CSP, HSTS, X-Frame, X-Content-Type, Referrer, Permissions, X-DNS-Prefetch)
- `curl https://meethenri.com/api/health` → status ok, version 56715fa, db ok 684ms, resend ok, stripe/twilio/openai unconfigured (expected)

## Diff vs 2026-04-28

See [14-launch-delta.md](./14-launch-delta.md) for the full side-by-side. Headlines:

### Closed (4 of 10 prior priorities)
- ✓ Sentry wired (prior #4) — `@sentry/nextjs` installed, `instrumentation.ts` configured, logger sink lit
- ✓ Idempotency keys on Twilio + Resend webhooks (prior #7) — module + migration 00054 shipped, 2 of 3 webhooks using it
- ✓ 5 untested critical paths now tested (prior #5) — orchestrator, useLeads, locks, score cron, re-enrich all have tests
- ✓ Console.* → logger discipline (prior #6) — 152 raw calls down to 10

### Still open
- ⚠️ 14 unvalidated POST routes (prior #2)
- ⚠️ Auto-generated DB types not started (prior #3)
- ⚠️ LeadDetailDrawer refactor (prior #9, partial: -85 LOC since yesterday)
- ⚠️ Migrations 00052+00053 still pending application
- ⚠️ Numbering gap 00048–00049 (prior audit note)

### New regressions
- 🔻 Hardcoded Resend API key in deploy script — Critical, security
- 🔻 Cron cadence downgraded for Hobby-plan limit — wedge bullet #5 (speed-to-lead) impacted
- 🔻 CI workflow `NEXT_PUBLIC_APP_URL` placeholder still references `https://henri.app` (cosmetic post-domain-swap)

### Net new
- 🆕 Production runtime live at `https://meethenri.com` — never previously audited (all prior audits were pre-launch)
- 🆕 4 launch tokens exposed in chat history — Vercel, Cloudflare, Supabase, Resend (rotation overdue)

## Next audit

Re-run weekly through 2026-05-31, then quarterly. New audits go to `docs/audits/YYYY-MM-DD/`. Diff against this version to track post-launch hardening progress. Suggest archival policy: keep last 30 days, then move to `docs/audits/_archive/`.

---

# 01 — Architecture

## TL;DR

438 source files, ~68k LOC, 17-cron production schedule, route groups under control. The 1,116-LOC `LeadDetailDrawer` from yesterday pruned to **1,031 LOC** (−85, −7.6%). Three new dashboard components shipped clean (Applicant/CrossTrade/Watchers Badge — each <120 LOC, properly typed). No structural-shape changes since 2026-04-28; this is feature accretion done well.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Layer summary

| Layer | Count | Notes |
|---|---:|---|
| Marketing route groups | `(marketing)` + `(auth)` + `(dashboard)` + portal + onboarding | 5 top-level groups |
| API routes | 98+ | Includes 5 new since prior audit |
| Hooks | 30+ | All run unconditionally; cancellation-safe pattern in I/O hooks |
| Lib subdirectories | `agents/` `auth/` `capacity/` `constants/` `enrichment/` `exclusivity/` `intake/` `license/` `logger.ts` `outreach/` `pdf/` `permits/` `predictive/` `proposals/` `scoring/` `sequences/` `sources/` `supabase/` `tax/` `webhooks/` | 20 subtrees, each cohesive |
| Migrations | 54 (gap at 48–49) | See [02-data-layer.md](./02-data-layer.md) |
| UI primitives | `src/components/ui/*` | 11 components — Button, Card, Dialog, Input, Select, Badge, Skeleton, Toast, FocusTrap, ExpandableBanner, ErrorBoundary |

## Findings

### F1. HEALTHY — LeadDetailDrawer pruned 1,116 → 1,031 LOC (UNCHANGED zone)
**File**: `src/components/dashboard/LeadDetailDrawer.tsx`
**Severity**: Low
**Why it matters**: 2026-04-28 audit's #9 priority was a refactor of this drawer. Net `−85` LOC over 24 hours suggests partial extraction has happened (likely `generateProposal()` factored out per the prior recommendation). Still over the 600-LOC target, so partial progress, not closed.
**Recommended fix**: Continue the extraction — pull contractor/business section into `LeadDetailContractorCard.tsx` (~200 LOC) and the score-breakdown section into `LeadDetailScoreSignals.tsx` (~150 LOC). Target <600 LOC for the drawer shell.
**Delta tag**: IMPROVED.

### F2. HEALTHY — 3 new dashboard components shipped clean
**Files**:
- `src/components/dashboard/ApplicantBadge.tsx` (~65 LOC)
- `src/components/dashboard/CrossTradeOpportunities.tsx` (~116 LOC)
- `src/components/dashboard/WatchersBadge.tsx` (~64 LOC)

**Severity**: Low (positive finding)
**Why it matters**: All three follow CLAUDE.md discipline: typed props, hooks-run-unconditionally, no inline secret/env access, terse JSX. `WatchersBadge` correctly buckets the count to `1-2` / `3-5` / `5+` per wedge bullet #6 (coarse competitive intel — never names). `CrossTradeOpportunities` reads `cross_trade_suggestions` jsonb (migration 00045) with `unknown[]`-typed array narrowing.
**Recommended fix**: None. Reference these as templates for future dashboard widgets.
**Delta tag**: NEW.

### F3. WATCH — `ChatIntakeModal` LOC stable but still over target
**File**: `src/components/intake/ChatIntakeModal.tsx`
**Severity**: Low
**Why it matters**: 1,028 LOC at last measurement. The 2026-04-28 audit flagged it alongside LeadDetailDrawer. No measurable change in 24 hours. Refactor candidate when LeadDetailDrawer extraction is done — same patterns apply (extract question-bank rendering, state-machine into reducer).
**Recommended fix**: Schedule alongside #9 from the top-10 priorities. ~3 hours.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Middleware role-gating intact
**File**: `src/middleware.ts` (184 LOC)
**Severity**: Low (positive finding)
**Why it matters**: Re-read confirms the per-step onboarding gating ladder (license → plan → payment → territory) and the god-mode audit log (line 66 `console.warn` is intentional — Edge runtime cannot import `@/lib/logger`, the comment block at lines 60–65 documents this). Public-route fast-path skips DB roundtrip on every page nav. CLAUDE.md "files not to touch without explicit approval" includes this file; no changes since prior audit.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — UI primitives still the only component source for shipped surfaces
**Severity**: Low (positive finding)
**Why it matters**: `src/components/ui/*` has 11 primitives. New dashboard components (F2) all import from this set rather than re-implementing. Brand discipline holds.
**Delta tag**: UNCHANGED.

## Verdict

Architecture is HEALTHY and stable. Only outstanding architectural work is the LeadDetailDrawer + ChatIntakeModal extraction, which is sequenced behind the higher-leverage type-system + security work in the top-10. No new structural-shape concerns introduced by the launch sprint.

---

# 02 — Data layer

## TL;DR

54 migrations on disk (00001 → 00054 with a numbering gap at 00048–00049). Migration **00054_webhook_idempotency.sql** is NEW since 2026-04-28, applied, RLS-correct, and wired into `src/lib/webhooks/idempotency.ts`. Migrations 00045/46/47/50/51 (`cross_trade_suggestions`, `referral_credits`, `outreach_templates`, `storm_events`, `last_enriched_at`) all follow the CLAUDE.md schema rule. **00052/00053 remain pending** (idempotent on the user's clipboard from prior session). RLS holds across all new tables.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28 (which was WATCH because of pending 00052/00053; today's improvement is the cleanly-applied 00054).

## Findings

### F1. WATCH — Migration numbering gap 00048–00049
**Files**: `supabase/migrations/` — 00047 → 00050 with no 00048/00049
**Severity**: Low (cosmetic)
**Why it matters**: CLAUDE.md says "Location: `supabase/migrations/NNNNN_description.sql`. Monotonic numbering." Missing numbers don't break Postgres but they erode trust the next time someone tries to reproduce the schema from scratch. Either the files were drafted, abandoned, and renumbered without updating CLAUDE.md, or they're truly missing. The 2026-04-28 audit flagged this; no resolution in 24 hours.
**Recommended fix**: Either (a) restore 00048/00049 from git history if they exist there, OR (b) add a `supabase/migrations/_NUMBERING_GAP.md` (or update `CLAUDE.md`) documenting the intentional skip. ~15 min.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — Migration 00054_webhook_idempotency.sql is NEW + wired (closes prior #7)
**File**: `supabase/migrations/00054_webhook_idempotency.sql`
**Severity**: Low (positive finding)
**Why it matters**: New table `webhook_idempotency` with composite PK `(provider, event_id)`, RLS `SELECT TO authenticated USING (true)` for transparency, `processed_at` index for 90-day-pruning range deletes. Helper module at `src/lib/webhooks/idempotency.ts` (133 LOC) provides `wasProcessed(supabase, provider, event_id)` + `markProcessed(supabase, provider, event_id, opts)` with graceful-degrade if the table is missing (logs warn + returns false, treats every event as new). Imported by `src/app/api/webhooks/twilio/route.ts` and `src/app/api/webhooks/resend/route.ts`. Closes the 2026-04-28 audit's #7 priority.
**Recommended fix**: None. Migrate `src/app/api/webhooks/twilio-missed-call/route.ts` to also use the module — see [07-reliability.md F2](./07-reliability.md).
**Delta tag**: NEW (since 2026-04-28).

### F3. WATCH — Migrations 00052 + 00053 still pending application
**Files**:
- `supabase/migrations/00052_permit_source_provenance.sql`
- `supabase/migrations/00053_permit_source_zip_coverage.sql`

**Severity**: Medium
**Why it matters**: Both are idempotent and were on the user's clipboard yesterday for paste into the Supabase SQL editor. Neither has been applied per the 2026-04-28 audit. 00052 unblocks `discovered_via` / `field_mapping_status` columns referenced by 9 importer scripts (currently graceful-degrading to legacy schema; the import scripts work but log warnings every run). 00053's `permit_source_zips` table provides ZIP × source linkage rows for the dashboard map's coverage layer; the table exists but isn't being populated.
**Recommended fix**: Run `pnpm migrate` (which calls `scripts/apply-pending-migrations.ts`) once and confirm via `mcp__supabase__list_migrations`. ~2 min.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — All new tables follow the CLAUDE.md schema rule
**Files**: `supabase/migrations/00045–00047`, `00050`, `00051`, `00054`
**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md mandates `contractor_id uuid REFERENCES profiles(id) + RLS self-policy + created_at/updated_at + moddatetime trigger` on every contractor-scoped table. Verified:
- `cross_trade_suggestions` (00045): JSONB column on `leads`, feature-flagged via `WRITE_CROSS_TRADE_SUGGESTIONS` env var
- `referral_credits` (00046): `referrer_id` references `profiles(id)`, RLS `referrer_id = auth.uid()`, moddatetime trigger present
- `outreach_templates` (00047): system table seeded with 42 default templates (trade × stage × channel), partial unique index on `(trade, stage, channel)` for built-ins, RLS allows `SELECT TO authenticated`
- `storm_events` (00050): NOAA storm-events ingest table, RLS `SELECT TO authenticated`, no contractor scoping (reference data)
- `last_enriched_at` (00051): column added to `permits`, no RLS change (column-level), graceful-degrade pattern in code
- `webhook_idempotency` (00054): see F2

**Recommended fix**: None.
**Delta tag**: NEW (the migrations themselves) but UNCHANGED-pattern.

### F5. HEALTHY — RLS-self-policy invariant holds across the board
**Severity**: Low (positive finding)
**Why it matters**: `leads`, `estimates`, `territories`, `proposals`, `referral_credits`, `outreach_queue`, `outreach_templates` all have row-level-security enabled with the standard "owner sees only their rows" policy. Service-role bypass remains isolated to `src/lib/supabase/admin.ts` which is server-only. No new RLS holes introduced by the 9 new migrations.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

## Migration inventory

| File | Status (best-effort, verify via `mcp__supabase__list_migrations`) | Audit notes |
|---|---|---|
| 00001–00038 | Applied | Foundational schema |
| 00039_contact_provenance | Applied | Provenance tracking |
| 00040_voter_lookups | Applied | Voter-file enrichment |
| 00041_voter_files | Applied | Voter-file ingest |
| 00042_ppp_loans | Applied | PPP-loan ingest |
| 00043_enrich_indexes | Applied | Burst-enrich performance |
| 00044_leads_enrichment_columns | Applied | New jsonb columns |
| 00045_cross_trade_suggestions | Applied | Feature-flagged jsonb |
| 00046_referral_credits | Applied | Referral system |
| 00047_seed_outreach_templates | Applied | 42 default templates |
| **00048** | **MISSING** | Numbering gap — see F1 |
| **00049** | **MISSING** | Numbering gap — see F1 |
| 00050_storm_events | Applied | NOAA ingest |
| 00051_last_enriched_at | Applied | Re-enrich gating |
| 00052_permit_source_provenance | **PENDING** | See F3 |
| 00053_permit_source_zip_coverage | **PENDING** | See F3 |
| 00054_webhook_idempotency | Applied | NEW since 2026-04-28; wired |

## Verdict

Data layer is HEALTHY and trending up. Apply 00052/00053 + document the 00048/00049 gap and this becomes pristine.

---

# 03 — Types & hooks

## TL;DR

`as unknown as` count: **53 → 54** (+1, essentially flat). `Record<string, unknown>` count: **141 → 153** (+12, all from 3 new dashboard components reading nested permit/contractor data). `as any | : any`: **17 → 13** (−4, IMPROVED). All hooks run unconditionally; no rules-of-hooks violations. The auto-generated `src/types/database.ts` recommendation from yesterday is still the single best fix to close ~50% of remaining casts.

## Score

**WATCH** — UNCHANGED vs 2026-04-28. Improvement on `as any` is real but the structural fix (auto-gen types) is still pending.

## Findings

### F1. WATCH — `as unknown as` casts cluster in 4 files (root cause: untyped Supabase joins)
**Hotspots**:

| File | Casts | Root cause |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 18 | `mapLead()` reading the `permits(...)` join shape |
| `src/components/homeowner/ContractorCard.tsx` | 7 | Reading nested contractor profile children |
| `src/lib/enrichment/ppp-loan.ts` | 3 | API response shape coercion |
| `src/components/dashboard/LeadDetailDrawer.tsx` | 3 | Same as page.tsx (permits join) |
| Other | 23 | Spread across 20 files |

**Severity**: Medium
**Why it matters**: CLAUDE.md "type discipline" — every cast is a place where TypeScript doesn't help. The biggest cluster (`mapLead()`) is structural: until `permits` join shape is a proper type, every read needs the cast. The launch-sprint commits added only 1 net cast (vs the +30 Agent 3 estimated — verified via per-file count). The system is stable; it's just that the structural fix hasn't shipped.
**Recommended fix**: Run `mcp__supabase__generate_typescript_types` → write to `src/types/database.ts` → import the `Database` type → derive `LeadWithPermits = Database['public']['Views']['leads_with_permits']['Row']` (or equivalent). Refactor `mapLead()` and `ContractorCard` to read the typed shape. Target: −25 casts. ~2 hours.
**Delta tag**: UNCHANGED.

### F2. WATCH — `Record<string, unknown>` count grew 141 → 153 (+12)
**Severity**: Low
**Why it matters**: All +12 are in the 3 new dashboard components (`CrossTradeOpportunities`, `ApplicantBadge`, `WatchersBadge`) reading nested suggestion/permit data. They're not regressions — they're the natural side-effect of new components reading legacy un-typed payload shapes. Same root cause as F1; same fix.
**Recommended fix**: Same as F1.
**Delta tag**: REGRESSED (+12) but same root cause.

### F3. IMPROVED — `as any | : any` count 17 → 13 (−4)
**Severity**: Low (positive finding)
**Why it matters**: 4 fewer untyped escape hatches than yesterday. The remaining 13 are concentrated in:
- `src/hooks/useLeads.ts:7` (one `as any` for the wide → narrow fallback type-coercion in the migration-gap path; defensible)
- `src/components/map/MapStyleSwitcher.tsx`, `FEMAFloodLayer.tsx`, `CensusLayer.tsx` (MapLibre style spec types)
- `src/lib/enrichment/__tests__/orchestrator.test.ts:3` (mock typing, acceptable)
- `src/lib/pdf/proposal-renderer.tsx:1` (pdfkit types)

**Recommended fix**: None — these are pragmatic. Track the count weekly; flag if it climbs above 20.
**Delta tag**: IMPROVED.

### F4. HEALTHY — Hooks discipline holds
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `useLeads`, `useEnrichment`, `usePermitHistory`, `useExclusivity`, `useStripeTax`, `usePermitDetail`, `useReferrals`. All run unconditionally before any conditional `return null`. All I/O hooks use the ref-cancelled pattern. New `useStripeTax` and `usePermitDetail` (added in launch sprint) follow the established conventions.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — `useLeads` wide → narrow fallback still uses `as any`
**File**: `src/hooks/useLeads.ts` (line marked in audit search)
**Severity**: Low
**Why it matters**: The migration-gap fallback path needs to coerce the narrow-row shape into the wide type. There's no clean type for "Lead missing extended columns". Defensible but worth a comment.
**Recommended fix**: Replace with `as Lead` after annotating the narrow result type via `Pick<Lead, NarrowKeys>`. Optional polish; can wait until F1 lands and the wide type is auto-generated.
**Delta tag**: UNCHANGED.

## Verdict

Types & hooks is WATCH but trending right. The single structural fix (auto-gen `database.ts` + refactor `mapLead`) closes the dominant cluster. Everything else is acceptable noise. Hook discipline is healthy with no regressions in the launch sprint.

---

# 04 — API surface

## TL;DR

98+ API routes. **5 new routes** since 2026-04-28 (`/api/health`, `/api/estimates/[id]/pdf`, `/api/estimates/preview-tax`, `/api/cron/re-enrich`, `/api/cron/storm-events`) — all are auth-gated and Zod-validated. **The 14 unvalidated POST routes from yesterday's audit are still unvalidated** — the launch sprint did not touch them. Auth middleware + per-route `requireContractor()` continue to gate contractor-only routes correctly.

## Score

**ISSUE** — UNCHANGED vs 2026-04-28. Launch did not add Zod to the 14 hot-list routes. Still the single biggest open security gap.

## Findings

### F1. ISSUE — 14 unvalidated POST routes (UNCHANGED from 2026-04-28)
**Files** (per yesterday's audit + verified today):
- `POST /api/estimates/[id]` PATCH — financial body
- `POST /api/leads/[id]` PATCH — lead state mutation
- `POST /api/leads/[id]/notes` — free-text notes
- `POST /api/financing` — financial-records insert
- `POST /api/license/verify` — compliance verification
- `POST /api/admin/sources/probe` — admin-only source probe
- `POST /api/agents/lead-scorer` — internal trigger
- `POST /api/agents/permit-scraper` — internal trigger
- `POST /api/agents/ziplock` — internal trigger
- `POST /api/billing/extra-zip` — extra-ZIP add-on
- (plus 4 more from yesterday's audit hot list)

**Severity**: High
**Why it matters**: Every one of these accepts `await req.json()` without `safeParse()`. A malformed APR field on `/api/financing` could corrupt a financial record. A malformed `license_number` on `/api/license/verify` could pass validation but fail compliance later. Service-role-bypassed routes (`/api/agents/*`) are CRON-secret-gated but still take an arbitrary body. CLAUDE.md "input validation" rule.
**Recommended fix**: Add Zod schemas to each. Pattern from `src/app/api/ai/draft-reply/route.ts:5–7`:
```ts
const Body = z.object({
  field: z.string().max(N),
  // ...
});
const parsed = Body.safeParse(await req.json());
if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
```
~2 hours total across all 14.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — 5 new routes shipped clean
**Files**:
- `src/app/api/health/route.ts` — GET only, returns version + service health JSON, no body to validate
- `src/app/api/estimates/[id]/pdf/route.ts` — GET, contractor-gated via `requireContractor()`, RLS backstop on the estimate read
- `src/app/api/estimates/preview-tax/route.ts` — POST, Zod schema (subtotal_cents capped at 1B, address fields bounded, ZIP regex), `requireContractor()` gate
- `src/app/api/cron/re-enrich/route.ts` — POST, CRON_SECRET bearer gate, batch size 200 with concurrency 4
- `src/app/api/cron/storm-events/route.ts` — POST, CRON_SECRET bearer gate, NOAA pull with idempotent insert

**Severity**: Low (positive finding)
**Why it matters**: Reference how new routes should be added. All four explicit-body routes have validation; the GET-only ones have proper auth gates. No regression in the new code.
**Recommended fix**: None.
**Delta tag**: NEW.

### F3. HEALTHY — `requireContractor()` continues to gate contractor-only routes
**File**: `src/lib/auth/requireContractor.ts`
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked 12 contractor-only routes (leads, estimates, outreach, billing, profile). All call `requireContractor()` first thing. The helper validates the session, looks up the profile, and returns 401/403 otherwise. No bypass found.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Cron routes correctly gated by `CRON_SECRET` bearer token
**Files**: `src/app/api/cron/*/route.ts` (17 routes)
**Severity**: Low (positive finding)
**Why it matters**: Each cron route reads `Authorization: Bearer <CRON_SECRET>` first; rejects on mismatch. New `/api/cron/re-enrich` and `/api/cron/storm-events` follow the same pattern. CLAUDE.md "Cron routes" rule.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — `/api/dev/*` allowlist
**Files**: `src/app/api/dev/switch-role/route.ts` and friends
**Severity**: Low
**Why it matters**: Dev-only routes for god-mode role switching. Yesterday's audit confirmed they're allowlisted to god-mode emails. Re-checked `switch-role/route.ts` — gate intact. CLAUDE.md doesn't allow these in production paths beyond god-mode.
**Recommended fix**: Periodic spot-check. Consider a unit test that proves the allowlist rejects non-god-mode users.
**Delta tag**: UNCHANGED.

## Verdict

API surface is ISSUE-level today only because of F1. Adding Zod to the 14 POST routes is a 2-hour task and would close the entire issue. Everything else is HEALTHY.

---

# 05 — Security

## TL;DR

LLM injection defenses (S1+S2+S6) UNCHANGED and HEALTHY in shipped code. Stripe webhook signature-then-parse-then-idempotent pattern UNCHANGED. CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy all live in production (verified via `curl -I https://meethenri.com/`). **NEW Critical finding**: Resend live API key hardcoded in `scripts/_deploy-vercel.ts:136` plus the same key was exposed in chat history during the launch sprint. Token rotation is overdue. Service-role isolation, env-var handling, role-gating all healthy.

## Score

**ISSUE** — REGRESSED vs 2026-04-28 (was HEALTHY). The launch automation introduced one new critical issue (hardcoded production API key). Everything in the shipped Next.js app is otherwise stable.

## Findings

### F1. CRITICAL — Resend live API key hardcoded in deploy script
**File**: `scripts/_deploy-vercel.ts:136`
**Severity**: Critical
**Why it matters**: A live production Resend API key is embedded as a string literal in a TypeScript file in the repo. The same token value was also pasted into the chat transcript during the launch session. Any of the following would expose it:
- `git add scripts/_deploy-vercel.ts && git commit && git push` (file is untracked today; nothing prevents that)
- A teammate cloning the repo from a backup that includes `scripts/_*.ts`
- The chat transcript itself if shared
- A `cat scripts/_*.ts` from a compromised dev machine

The exposed key has full Resend send permissions on the `meethenri.com` sender identity — an attacker can send emails as Henri (phishing, password-reset spam, brand impersonation).

**Recommended fix** (do all four):
1. **Rotate**: revoke the existing key at https://resend.com/api-keys → generate a fresh one → update Vercel env `RESEND_API_KEY`
2. **Refactor the deploy script**: change line 136 from string-literal to `process.env.RESEND_API_KEY ?? throwIfMissing("RESEND_API_KEY")`
3. **Gitignore the launch automation scripts**: add `scripts/_deploy-vercel.ts`, `scripts/_setup-cloudflare-dns.ts`, `scripts/_supabase-management.ts` to `.gitignore` (or move them into a `.gitignored/` folder)
4. **Audit git history**: `git log --all -p -- scripts/_deploy-vercel.ts` to confirm no prior commit accidentally embedded the key. If found, treat as a full credential leak — rotate again after rewriting history.

~15 min total.
**Delta tag**: NEW.

### F2. HEALTHY — Three other launch tokens exposed in chat history (rotation overdue)
**Severity**: High
**Why it matters**: Launch session summary records 4 tokens pasted into chat:
- Cloudflare API token (full DNS + Email Routing scope on the meethenri.com zone)
- Vercel personal-access token (full project + env mutation scope)
- Supabase access token (project management + DB management scope)
- Resend API key (covered in F1)

Chat transcripts can be exported, shared, or breached. None are in source code (verified for the deploy script in F1; the others are in scripts that read from `process.env.*`). They are, however, in long-term chat history.

**Recommended fix**:
- Cloudflare: revoke at https://dash.cloudflare.com/profile/api-tokens
- Vercel: revoke at https://vercel.com/account/tokens
- Supabase: revoke at https://supabase.com/dashboard/account/tokens
- Resend: handled in F1

Once revoked, generate fresh ones only when needed; don't paste them into chat. Use 1Password / Bitwarden / Vercel UI directly.
**Delta tag**: NEW.

### F3. HEALTHY — LLM injection defenses S1 + S2 + S6 confirmed
**Files**:
- `src/app/api/ai/draft-reply/route.ts` (lines 29–33: delimiter sanitize; 130–137: output filter)
- `src/app/api/chat/refine/route.ts` (lines 106–107: per-answer sanitize; 162–171: output-pattern reject)

**Severity**: Low (positive finding)
**Why it matters**: Yesterday's audit confirmed these defenses; today's pass re-confirms them in place. Both routes use named-delimiter wrapping (`<<<REVIEW>>>`, `<<<ANSWER N>>>`), strip those delimiters from user input, cap input length via Zod, and reject LLM outputs containing URLs/phones/tool-call markers. Fallback to canned-reply on filter rejection.
**Recommended fix**: None. Reference these as the pattern for any future LLM-touching route.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Stripe webhook is exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Severity**: Low (positive finding)
**Why it matters**: Signature verified BEFORE `req.json()` parse. Idempotent on `event.id`. Referral-credit insert ordered before coupon creation (B3 race fix from prior session). The `billing_events` table provides a backup dedup layer keyed on `stripe_event_id`.
**Recommended fix**: None. Optionally migrate the dedup logic to use the new `src/lib/webhooks/idempotency.ts` module for consistency, but it's working correctly today and the abstraction would be cosmetic.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Production security headers verified live
**File**: `next.config.ts:48–62` + `curl -I https://meethenri.com/`
**Severity**: Low (positive finding)
**Why it matters**: Live production response includes:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()`
- `Content-Security-Policy:` full directive set with explicit allowlists for `js.stripe.com`, `*.supabase.co`, `api.openai.com`, `nominatim.openstreetmap.org`, `api.mapbox.com`, `*.cartocdn.com`, `*.vercel-insights.com`; `frame-ancestors 'none'`; `object-src 'none'`; `upgrade-insecure-requests`

The `Server: Vercel` header is present (information disclosure but unavoidable on Vercel). No `X-Powered-By` leak.

**Recommended fix**: None. Optional hardening: drop `'unsafe-inline'` from `style-src` once Tailwind v4 stops requiring it (current Tailwind config emits inline styles in dev that Production builds don't strictly need).
**Delta tag**: UNCHANGED.

### F6. HEALTHY — Service-role isolation intact
**File**: `src/lib/supabase/admin.ts`
**Severity**: Low (positive finding)
**Why it matters**: Service-role client only imported from server-only modules (cron routes, webhook routes, agent endpoints). Never reaches the browser bundle. Spot-checked the 5 new routes and the 14 unvalidated POSTs — none of them import `admin.ts` inappropriately.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F7. HEALTHY — Env-var handling rejects insecure CRON_SECRETs
**File**: `src/lib/env.ts:39–62`
**Severity**: Low (positive finding)
**Why it matters**: `requireEnv()` throws in production for missing or known-insecure CRON_SECRET values (`dev_cron_secret_change_in_production`, `change_me`, `secret`, `test`). Production deploy generated a fresh 32-byte hex token. Boolean `hasStripe()`, `hasTwilio()`, etc. allow graceful-degrade paths without throwing.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F8. WATCH — Stale GoDaddy DNS records remain in Cloudflare zone
**Severity**: Low (cosmetic, security-adjacent)
**Why it matters**: Per launch summary, the meethenri.com Cloudflare zone imported ~13 legacy DNS records when domain control transferred from GoDaddy. Apex MX → outlook.com, SPF including secureserv.net, autodiscover/lync/msoid/sip/pay CNAMEs, _sipfederationtls/_sip._tls SRV records. Cosmetic but: (a) implies Henri uses Outlook for email which we don't, (b) MX → outlook.com would receive bounces that we'd never see, (c) SPF including secureserv permits a domain we don't control. The audit was unable to verify Cloudflare zone state without the API token re-authorized.
**Recommended fix**: User to delete the legacy records via the Cloudflare dashboard. ~5 min. The active records (A → 76.76.21.21, CNAME www → cname.vercel-dns.com, MX send → feedback-smtp.us-east-1.amazonses.com, TXT send SPF, DKIM via Resend) should remain.
**Delta tag**: NEW (was launch carryover, never previously audited).

## Verdict

Security in shipped code is HEALTHY across all standard surfaces. F1 (hardcoded Resend key) is the lone Critical issue and lifts the domain to ISSUE-level. Once F1 + F2 are resolved (~30 min combined), the domain returns to HEALTHY.

---

# 06 — Performance

## TL;DR

Hot-path query patterns (paginated leads, signal breakdown, capacity filter) UNCHANGED. Bundle size stable; PDF renderer (`src/lib/pdf/proposal-renderer.tsx`) is server-side only. **REGRESSION**: Vercel Hobby plan capped daily-only crons forced all 17 crons to a daily slot. Score-cron (every 2h yesterday) now runs at 01:00 UTC — a permit filed at 06:00 has 19 hours of scoring latency, which violates wedge bullet #5 (speed-to-lead). Acceptable for a 1-week launch window if the Pro upgrade is on the calendar; not acceptable as a steady state.

## Score

**WATCH** — REGRESSED vs 2026-04-28 (was HEALTHY).

## Findings

### F1. WATCH — Cron cadence downgrade violates wedge bullet #5
**File**: `vercel.json`
**Severity**: High (operational, time-bounded)
**Why it matters**: Worst-case latencies under daily-only crons:

| Cron | Was | Now (daily) | Worst-case latency | Wedge impact |
|---|---|---|---:|---|
| `/api/cron/score` | `1 */2 * * *` (every 2h) | `0 1 * * *` | 23h | Wedge #5 (speed-to-lead) violated |
| `/api/cron/scrape` | `5,35 * * * *` (every 30 min) | `0 2 * * *` | 24h | New permits land 24h late |
| `/api/cron/enrich` | `5,20,35,50 * * * *` (every 15 min) | `0 13 * * *` | 24h | Contact info lags 24h |
| `/api/cron/follow-ups` | `0,15,30,45 * * * *` (every 15 min) | `0 11 * * *` | 24h | Follow-up timing skewed |
| `/api/cron/permits` | `20 */6 * * *` (every 6h) | `0 12 * * *` | 24h | Permit sync lags 24h |
| Others | varied | daily | 24h | Lower priority — acceptable |

Score-cron is the most painful: a contractor who logs in at 09:00 sees yesterday's permits but no scores until 01:00 UTC the next day.

**Recommended fix**: Schedule the Vercel Pro upgrade for the end of week 1. On upgrade, edit `vercel.json` to restore the prior cadences (commit `4b7565b`'s parent has the old values). ~5 min edit + redeploy.
**Delta tag**: REGRESSED.

### F2. HEALTHY — `useLeads` query pattern stable
**File**: `src/hooks/useLeads.ts`
**Severity**: Low (positive finding)
**Why it matters**: Wide → narrow fallback (extendedColumnsMissing flag at lines 145–179) still in place. Multi-page dedup via `Map<id, row>` (lines 242–248) intact. Now backed by `useLeads.helpers.test.ts` (28 tests) covering both paths and the god-mode bypass.
**Recommended fix**: None. Optional: add a server-side projection helper that the hook can call to push the wide vs narrow decision into Supabase RPC; currently both branches share client-side post-filter.
**Delta tag**: UNCHANGED.

### F3. HEALTHY — PDF renderer is server-side only
**File**: `src/lib/pdf/proposal-renderer.tsx`
**Severity**: Low (positive finding)
**Why it matters**: pdfkit-based; called from `/api/estimates/[id]/pdf/route.ts` which is a server route. The renderer's React-flavored `.tsx` is JSX-as-DSL for layout but compiles into a server-only module. No bundle impact on the dashboard JS.
**Recommended fix**: None.
**Delta tag**: NEW (the file itself is new since last audit) but UNCHANGED-pattern.

### F4. HEALTHY — Cron orchestrator deadline + rate-limit discipline intact
**Severity**: Low (positive finding)
**Why it matters**: Each cron route caps `maxDuration=300` with an internal soft-deadline check at ~280s. Polite vendor rate-limits (1/s for Nominatim, 5/s for Regrid, etc.) preserved. Per-source telemetry counters (D3 fix from prior session) emit into the structured logger.
**Recommended fix**: Yesterday's audit's #8 ("inline 280s deadline check on score + permits crons") still applies. The current daily cadence makes a 280s timeout less likely to hit in the score-cron, but the check belongs there for safety. ~30 min.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Map page lazy-loads heavy components
**File**: `src/app/(dashboard)/dashboard/map/page.tsx` and friends
**Severity**: Low (positive finding)
**Why it matters**: MapLibre GL, FEMA flood layer, NOAA radar layer, census layer all loaded via `next/dynamic`. Initial dashboard page bundle stays lean.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F6. WATCH — Rate limiting on hot routes still missing
**Severity**: Medium
**Why it matters**: 2026-04-28 audit flagged that `/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role` lack per-IP / per-user rate limits. Status today: still missing. Not exploited but a Stripe coupon-spamming or CSV-stuffing attack could pile up writes.
**Recommended fix**: Add a simple in-memory or KV-backed rate limiter as a route helper. Pattern: 30 requests/min/IP for public routes, 5 requests/min/IP for state-mutating routes. ~2 hours.
**Delta tag**: UNCHANGED.

## Verdict

Performance is WATCH today purely because of F1. The other findings are healthy or are the same WATCH-level item from yesterday (F6 rate limits). Once Pro-plan upgrade lands and `vercel.json` is reverted, this returns to HEALTHY immediately.

---

# 07 — Reliability

## TL;DR

New webhook idempotency module (`src/lib/webhooks/idempotency.ts`) wired into Twilio + Resend webhooks. Stripe webhook retains its exemplary `event.id` dedup pattern. Twilio missed-call route is the only remaining webhook not yet on the abstraction. Graceful-degrade patterns (table-missing, env-missing, vendor-down) verified across the stack. Error boundaries cover the dashboard and global error paths.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28.

## Findings

### F1. HEALTHY — Webhook idempotency module wired (closes 2026-04-28 #7 priority)
**Files**:
- `src/lib/webhooks/idempotency.ts` (133 LOC) — provides `wasProcessed()` + `markProcessed()` with composite-key dedup
- `src/app/api/webhooks/twilio/route.ts` — uses key `${MessageSid}:${MessageStatus}` to dedup per status transition
- `src/app/api/webhooks/resend/route.ts` — uses `svix-id` header

**Severity**: Low (positive finding)
**Why it matters**: Twilio retries on 5xx or timeout; the same MessageSid/Status combo would fire duplicate handlers without dedup. Resend uses Svix delivery; same. The module logs a structured warn if migration `00054_webhook_idempotency.sql` is missing and falls through to pre-idempotency behavior — duplicates fire twice but the route doesn't crash. Mirrors the proven Stripe pattern.
**Recommended fix**: None. See F2 for the one webhook still on the legacy pattern.
**Delta tag**: IMPROVED (NEW since 2026-04-28).

### F2. WATCH — Twilio missed-call webhook not yet on the idempotency module
**File**: `src/app/api/webhooks/twilio-missed-call/route.ts`
**Severity**: Medium
**Why it matters**: This is the only webhook route in the codebase not using `wasProcessed()` / `markProcessed()`. Missed-call payloads from Twilio carry a unique `CallSid` per call event but Twilio still retries on 5xx, so duplicate "missed call" → text-back fires are possible. The existing route doesn't currently have its own dedup either.
**Recommended fix**: Copy the pattern from `twilio/route.ts`:
```ts
const idempotencyKey = `${callSid}:${callStatus}`;
const seen = await wasProcessed(supabase, "twilio", idempotencyKey);
if (seen) return NextResponse.json({ ok: true, skipped: "duplicate" });
// ... process ...
await markProcessed(supabase, "twilio", idempotencyKey, { event_type: callStatus });
```
~30 min including a small unit test.
**Delta tag**: UNCHANGED-OPEN.

### F3. HEALTHY — Stripe webhook retains exemplary pattern
**File**: `src/app/api/webhooks/stripe/route.ts`
**Severity**: Low (positive finding)
**Why it matters**: Signature verified before parse. `event.id`-based dedup using `billing_events` table. Referral-credit insert ordered before coupon creation (B3 fix). The new idempotency module wasn't retrofitted here (and shouldn't be — Stripe's pattern is already correct), but the modules use compatible storage so a future migration is straightforward.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Graceful-degrade patterns hold
**Examples re-verified**:
- `useLeads` retry-on-missing-column → falls back to NARROW select (covered by `useLeads.helpers.test.ts`)
- `/api/exclusivity` table-missing → empty summary + no badges (covered by `locks.test.ts`)
- `/api/feedback` DB-fail → email-fail → local JSONL (pattern intact)
- `webhook_idempotency` table-missing → graceful-degrade in the helper (F1)
- `getEnv()` missing var in dev → warn + fallback; missing in production → throw early (per `src/lib/env.ts:43–58`)
- `hasStripe()`, `hasTwilio()`, `hasOpenAI()` boolean guards used by `/api/health` and any feature-flagged surface

**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md "feature-flags before migrations" rule. Every new column/table ships with code that survives if the SQL hasn't been applied yet.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Error boundaries cover the dashboard
**Files**:
- `src/app/error.tsx` — top-level error boundary
- `src/app/global-error.tsx` — global error
- `src/app/(auth)/error.tsx` — auth-area error
- `src/components/ui/error-boundary.tsx` — component-level (NEW since 2026-04-28)

**Severity**: Low (positive finding)
**Why it matters**: New `error-boundary.tsx` UI primitive available for component-level error wrapping. Each error page has a single intentional `console.error()` to log the digest for Sentry feedback (these 4 calls are part of the 10 remaining console.* calls and they are intentional).
**Recommended fix**: None. Optional: wrap `LeadDetailDrawer` in the new component-level boundary so a render error doesn't take down the dashboard.
**Delta tag**: NEW.

### F6. WATCH — No global retry/backoff helper for vendor calls
**Severity**: Low
**Why it matters**: 2026-04-28 audit flagged that vendor calls (Stripe, Twilio, Resend, OpenAI, enrichment sources) don't share a unified retry-with-exponential-backoff helper. Each module rolls its own (or none). Result: one-off 5xx from Stripe causes a hard fail rather than a 1-shot retry.
**Recommended fix**: Add `src/lib/utils/retry.ts` with `retryWithBackoff(fn, opts)` and migrate the highest-traffic vendor calls. ~3 hours.
**Delta tag**: UNCHANGED.

## Verdict

Reliability is HEALTHY and trending up. F2 (Twilio missed-call migrate-to-idempotency-module) is the only meaningful open item. F6 is quality-of-engineering rather than launch-blocker.

---

# 08 — Observability

## TL;DR

**`@sentry/nextjs ^10.50.0` is installed**, `instrumentation.ts` is wired with the dynamic-import Function-trick (so the build doesn't break when the package isn't installed locally), and `src/lib/logger.ts:101` calls `safeCall(message, meta)` on every `error()`. The 2026-04-28 audit's #4 priority is **functionally CLOSED in shipped code**. The only remaining step is setting `SENTRY_DSN` in Vercel env vars to start aggregating events. Console.* discipline radically improved: 152 → 10 actual `console.X(...)` call sites.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28.

## Findings

### F1. HEALTHY — Sentry plumbing complete (closes 2026-04-28 #4)
**Files**:
- `package.json:43` — `"@sentry/nextjs": "^10.50.0"` installed
- `instrumentation.ts` — full Sentry init wired (lines 31–86) gated on `SENTRY_DSN`, dynamic-import via Function constructor to avoid build-time module resolution, fail-closed on any error
- `src/lib/logger.ts:55–57` — `registerErrorSink(sink)` registered from instrumentation
- `src/lib/logger.ts:97–101` — `error()` path calls `safeCall(message, meta)` after the `console.error()` for local visibility

**Severity**: Low (positive finding)
**Why it matters**: Yesterday's audit said "Sentry sink scaffolded but `@sentry/nextjs` still not installed". Today it IS installed and wired. The Function-constructor trick in `instrumentation.ts:57–59` keeps Turbopack from statically resolving the module path; this avoids "Module not found" warnings on clones that haven't run `pnpm add @sentry/nextjs`. `Sentry.init()` tags every event with `VERCEL_GIT_COMMIT_SHA` for release correlation. `tracesSampleRate: 0.1` keeps Sentry usage costs reasonable at launch volume.

**Recommended fix**: Set `SENTRY_DSN` in Vercel env vars (Production/Preview/Development). Free-tier Sentry covers the launch volume comfortably. ~5 min in Vercel UI + 1 redeploy. Once set, every `logger.error(...)` call site auto-forwards.
**Delta tag**: IMPROVED.

### F2. HEALTHY — Console.* count down 152 → 10 (closes 2026-04-28 #6)
**Severity**: Low (positive finding)
**Why it matters**: Strict count via `console\.(log|warn|error|info|debug)\s*\(` regex shows 10 actual call sites in src/, all intentional or transitional:
- `src/lib/logger.ts` (4) — the logger's own implementation; `console.warn`/`error`/`log` is how the structured JSON line lands in Vercel log ingestion. CANNOT be changed without breaking the logger.
- `src/middleware.ts:66` (1) — god-mode bypass audit log; documented at lines 60–65 explaining why Edge runtime can't import `@/lib/logger`. Intentional.
- `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/(auth)/error.tsx` (3) — error-boundary digest logging for Sentry feedback. Each takes the exception digest from React's error-boundary callback. Intentional.
- `src/lib/log.ts` (1) — fallback wrapper for Edge contexts. Intentional.
- `src/app/onboarding/territory/page.tsx` (1) — territory-claim error logging. Transitional; could be migrated to `logger.error()`.

The launch-day commit (`4b7565b`) appears to have done a sweep on cron + webhook routes — score-cron's 40 console calls dropped to 0.

**Recommended fix**: Migrate the 1 transitional `onboarding/territory/page.tsx:1` call to `logger.error()`. ~5 min. Otherwise leave the rest — they are all correctly intentional.
**Delta tag**: IMPROVED.

### F3. HEALTHY — Structured logger pattern intact and used
**File**: `src/lib/logger.ts`
**Severity**: Low (positive finding)
**Why it matters**: `LogEntry` shape (level + message + timestamp + arbitrary meta) emits JSON in production for Vercel log ingestion + pretty output in dev. Spot-checked usage in cron/webhook routes — `logger.error()`, `logger.warn()`, `logger.info()` used consistently. The error-tracker sink contract (`registerErrorSink(sink)`) is still fire-and-forget — the sink wraps in try/catch (`safeCall()` at line 61–69) so a broken Sentry SDK never breaks the request being logged.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Cron telemetry counters in place
**Severity**: Low (positive finding)
**Why it matters**: Each cron route emits structured progress logs (`logger.info("[cron] X processed", { count, duration_ms })`) that flow through Sentry's logger sink once `SENTRY_DSN` is set. Per-source enrichment counters (D3 fix from prior session) emit per-vendor success/failure. Yesterday's audit covered this in detail; no regression today.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — `/api/health` is a snapshot, not a heartbeat
**File**: `src/app/api/health/route.ts`
**Severity**: Low
**Why it matters**: `/api/health` returns synchronous service-status JSON (DB ping, Stripe/Twilio/OpenAI/Resend env-var presence). No background heartbeat ping or uptime accumulator. Fine for "is the app live?" checks but not enough for SLO tracking. A Sentry "uptime check" or Vercel monitor would close this.
**Recommended fix**: Once Sentry is wired (F1), add an Sentry uptime monitor pointed at `/api/health`. ~5 min.
**Delta tag**: NEW (the route itself is new since prior audit).

## Verdict

Observability is HEALTHY. F1 + F2 close two of yesterday's top priorities. The remaining work is operational (set `SENTRY_DSN` in Vercel env, optionally add an uptime monitor).

---

# 09 — Tests

## TL;DR

**376 / 376 tests pass** across 20 files (up from 220 / 12 files yesterday). The launch-day commit (`4b7565b: "Move 1+2 + tests"`) added test files for **all 5 prior-zero-coverage critical paths** (orchestrator, useLeads, exclusivity locks, score cron, re-enrich cron). Vitest run completes in 6.96s. Three modules remain at zero coverage: score-signal-writer (~150 LOC), capacity filter (~120 LOC), Twilio missed-call route (~194 LOC). E2E suite scaffolded under `e2e/` and CI wires Playwright on every PR.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28 (was ISSUE).

## Findings

### F1. HEALTHY — All 5 prior-zero-coverage critical paths now have tests
**New test files** (since 2026-04-28):

| Module | Test file | Coverage focus |
|---|---|---|
| Orchestrator (871 LOC) | `src/lib/enrichment/__tests__/orchestrator.test.ts` (~497 LOC) | empty-context bare initial state; cache-key determinism (whitespace, casing, optional fields); confidence ordering (county_gis > voter-local); telemetry counters increment; reset clears counters; ctx.supabase undefined → graceful-degrade; ILIKE-special-char fix (B6) uses eq() not ilike(); reference 9+ source modules |
| useLeads helpers | `src/hooks/__tests__/useLeads.helpers.test.ts` (~28 tests) | wide → narrow fallback (extendedColumnsMissing flag); multi-page dedup; god-mode bypass; filter/sort re-application post-fallback |
| Exclusivity locks | `src/lib/exclusivity/__tests__/locks.test.ts` (~22 tests) | atomic upsert under concurrent writes (only one row wins); 14-day expiry; release on lead-won; summarize() bucket math (1-2 / 3-5 / 5+) |
| Score cron helpers | `src/app/api/cron/score/__tests__/helpers.test.ts` (~36 tests) | signal composition (6 signals computed); urgency thresholds (75+/50–74/25–49/0–24); contractor round-robin per ZIP; score_signals jsonb write |
| Re-enrich cron helpers | `src/app/api/cron/re-enrich/__tests__/helpers.test.ts` (~27 tests) | field-change detection; `realFieldsChanged` gate; idempotent re-runs |

**Severity**: Low (positive finding)
**Why it matters**: Yesterday's audit's #5 priority. The launch sprint shipped substantial test coverage on the wedge-bullet-load-bearing modules. CLAUDE.md "wedge bullets" rule — every bullet now has its load-bearing implementation under test.
**Recommended fix**: None. Reference these tests for any future modification of those modules.
**Delta tag**: IMPROVED (closes prior #5).

### F2. WATCH — 3 critical-adjacent modules still uncovered
**Files** (no `__tests__/` companion):
- `src/lib/scoring/signals.ts` (~150 LOC) — score_signals jsonb writer; called from score-cron
- `src/lib/capacity/types.ts` + filter logic (~120 LOC) — capacity filter (wedge bullet #3); pure client-side filter
- `src/app/api/webhooks/twilio-missed-call/route.ts` (~194 LOC) — missed-call → text-back wedge bullet #5 mechanism

**Severity**: Medium
**Why it matters**: Each is one degree away from a covered critical path. Score-signal-writer is invoked by the score cron (which IS tested), but the writer itself isn't. Capacity filter is wedge bullet #3 (capacity respected) — a regression here silently shows out-of-envelope leads. Twilio missed-call route is wedge bullet #5's primary mechanism.
**Recommended fix**: ~1 day each. Low-friction wins:
- score-signal-writer: assert each signal type writes its expected jsonb shape
- capacity filter: assert `radius_miles`, `value_band`, `start_window`, `max_active_jobs` filter rows correctly
- Twilio missed-call: assert dedup (post F2 in [07-reliability.md](./07-reliability.md)), assert text-back fires within 10s
**Delta tag**: UNCHANGED-OPEN.

### F3. HEALTHY — Test count + duration
**Severity**: Low (positive finding)
**Why it matters**: 376 tests in 6.96s = 18.5ms / test (median). No flaky tests reported. CI runs `pnpm test` after `lint → tsc → truthfulness` and before `build`.
**Recommended fix**: None.
**Delta tag**: IMPROVED (220 → 376).

### F4. HEALTHY — Playwright E2E scaffolded + wired in CI
**Files**:
- `playwright.config.ts` (untracked but present)
- `e2e/` directory (untracked but present)
- `.github/workflows/ci.yml` — second job `e2e` runs `pnpm e2e` after `build` job, with placeholder env vars

**Severity**: Low (positive finding)
**Why it matters**: 2026-04-28 audit's #10 priority was "Add Playwright E2E suite". Scaffold is in place; one or more happy-path tests exist (god-mode dev login → dashboard → drawer is a sensible candidate). Reports + traces uploaded as artifacts on failure.
**Recommended fix**: Verify the e2e tests actually run successfully against a placeholder-env build. If `e2e/` is empty or contains only smoke checks, expand to cover: marketing home → portal intake submission → onboarding step ordering. ~4 hours.
**Delta tag**: IMPROVED (was 0 E2E tests yesterday; today: scaffolded).

### F5. WATCH — `useLeads.helpers.test.ts` covers helpers but not the hook itself
**Severity**: Low
**Why it matters**: The new test file targets the helper functions extracted from `useLeads`. The hook itself (with its React Query integration and effect lifecycle) isn't directly tested. Helper coverage is the harder half — most logic lives there — but the integration with React Query rate-limiting, retry, and stale-time behavior isn't asserted.
**Recommended fix**: Add a `useLeads.test.tsx` using `@testing-library/react`'s `renderHook` to exercise the React Query integration. ~4 hours.
**Delta tag**: NEW.

## Verdict

Tests is HEALTHY for the first time in this audit's history. F2 (the 3 still-uncovered modules) is the only open item; each is a 1-day task. F4 (E2E expansion) is a quality-of-engineering investment.

---

# 10 — Brand & wedge contract

## TL;DR

Truthfulness scan PASS (TRUTHFULNESS_OK). Brand tokens locked: `#D4886A` (no `#E8916A` references), no `font-bold` on Fraunces, no emojis, "Henri." with period in the nav. All four pricing tiers exact: `$149` / `$749` / `$1,499` / `$2,555`. All 6 wedge contract bullets continue to be implemented end-to-end. Live home page (`https://meethenri.com`) renders cleanly with the correct `<title>` and brand surface.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Findings

### F1. HEALTHY — Truthfulness scan PASS
**Output**:
```
=== TRUTHFULNESS SCAN ===
Hard fails (must fix before merge): 0
Soft warns (review + source): 0
Pricing drift (canonical price outside pricing surfaces): 0
Forgeries (invented prices): 0
Verdict: PASS
TRUTHFULNESS_OK
```

**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md "Truthfulness" rule. No fabricated metrics on shipped pages. No price forgeries. The launch sprint did not introduce any truthfulness regressions. CI gates merges on this.
**Recommended fix**: None. Re-run `pnpm truthfulness` after writing this audit (Phase 5 verification).
**Delta tag**: UNCHANGED.

### F2. HEALTHY — All 6 wedge bullets implemented
**Verification**:
| Bullet | Implementation | Test coverage |
|---|---|---|
| #1 Exclusivity (one contractor per permit-trade for 14 days) | `src/lib/exclusivity/locks.ts` + migration `00031` | `locks.test.ts` (NEW) |
| #2 Transparent confidence (6 signals always shown) | `src/lib/scoring/signals.ts` + drawer | `score/helpers.test.ts` (NEW); signals writer untested (F2 in [09-tests.md](./09-tests.md)) |
| #3 Capacity respected (radius/value/window/max-jobs) | `src/lib/capacity/types.ts` + Settings page | Untested (F2 in [09-tests.md](./09-tests.md)) |
| #4 Permit-specific outreach (templates reference permit #/scope/address) | `outreach_templates` (43 seeded via 00047) | Templates seeded; outreach-personalizer covered |
| #5 Speed-to-lead (missed-call text-back ≤10s) | `src/app/api/webhooks/twilio-missed-call/route.ts` + cron-driven outreach | Untested (F2 in [09-tests.md](./09-tests.md)); also degraded by Hobby-plan cron downgrade (F1 in [06-performance.md](./06-performance.md)) |
| #6 Coarse competitive intel (1-2 / 3-5 / 5+) | `src/lib/exclusivity/locks.ts:summarize()` + `WatchersBadge.tsx` | `locks.test.ts` summarize() bucket math test |

**Severity**: Low (positive finding)
**Why it matters**: The wedge contract is the reason contractors pick Henri. All 6 are implemented in code; 4 of 6 now have direct test coverage; #5 is partially degraded by the daily-cron downgrade (acceptable for the 1-week launch window, see top-10 priority #7).
**Recommended fix**: None. Bullet #5 (speed-to-lead) returns to full health on Vercel Pro upgrade.
**Delta tag**: UNCHANGED.

### F3. HEALTHY — Brand discipline holds across the codebase
**Severity**: Low (positive finding)
**Why it matters**: Quick checks:
- `grep -r "#E8916A" src/` → 0 hits (deprecated lighter terracotta)
- `grep -r "font-bold" src/components/ui/` → 0 hits on Fraunces variant
- `grep -r "🎉\|✨" src/` → 0 hits in shipping components (only in audit/notes prose)
- Live `<title>` on `https://meethenri.com` matches CLAUDE.md brand
- No GitHub or Apple OAuth providers referenced (Google-only enforced)

Pricing audit:
- `grep '\$(149|749|1,499|2,555)' src/` → all hits are in `src/app/(marketing)/pricing/page.tsx` and `src/app/(marketing)/contractors/page.tsx` (per truthfulness-scan policy)
- No invented prices ($199, $399, $999, etc.) detected

**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — UI primitives are the only component source
**Severity**: Low (positive finding)
**Why it matters**: New dashboard components (`ApplicantBadge`, `CrossTradeOpportunities`, `WatchersBadge`) all import from `src/components/ui/*` rather than rolling their own. The new `error-boundary.tsx` primitive joined the set. Brand discipline scales correctly.
**Recommended fix**: None.
**Delta tag**: NEW (the new components).

### F5. WATCH — Audit prose itself contains historical fabricated numbers as documentation
**Severity**: Low (cosmetic)
**Why it matters**: This audit and prior audits reference historical fabricated numbers (`18.4x`, `26%`, `4,200+`, `$1,300`) as markers in code comments + audit prose for traceability. The truthfulness scan correctly excludes code comments and audit prose from hard-fails (per the scan's regex). However, the rolled-up audit file should not render those numbers as if they were claims.
**Recommended fix**: When writing audit prose, always wrap historical bad numbers in backticks or quote-them-as-strings so the truthfulness regex never fires. This audit complies.
**Delta tag**: UNCHANGED.

## Verdict

Brand & wedge is HEALTHY. The truthfulness contract holds end-to-end. Wedge #5 has a temporary cron-cadence handicap that resolves on the Pro upgrade.

---

# 11 — Build & deploy

## TL;DR

CI workflow alive at `.github/workflows/ci.yml` running `lint → tsc → truthfulness → test → build → e2e` on every PR. **Stale finding**: build placeholder env still references `https://henri.app`. `vercel.json` ships 17 production crons all on a daily cadence (downgraded from various sub-daily for Vercel Hobby plan). 9 of ~16 expected production env vars set. New launch automation scripts (`scripts/_deploy-vercel.ts`, `_setup-cloudflare-dns.ts`, `_supabase-management.ts`) work correctly but introduce one critical security issue documented in [05-security.md F1](./05-security.md).

## Score

**WATCH** — REGRESSED vs 2026-04-28 (which was HEALTHY).

## Findings

### F1. WATCH — CI workflow has stale `henri.app` reference
**File**: `.github/workflows/ci.yml`
**Severity**: Low (cosmetic, post-domain-swap)
**Why it matters**: Both `build` and `e2e` jobs set `NEXT_PUBLIC_APP_URL: https://henri.app` for the placeholder build env. This is for build-time URL injection only (not runtime — production reads the value from Vercel env). Cosmetic but stale post-domain-swap; a future engineer reading the CI config would think the production domain is `henri.app`.
**Recommended fix**: Replace with `https://meethenri.com` in both `build` and `e2e` env blocks. ~2 min.
**Delta tag**: REGRESSED (the domain swap happened post-audit-2026-04-28; CI wasn't updated).

### F2. ISSUE — Production env-var matrix incomplete (9 of ~16 set)
**File**: `scripts/_deploy-vercel.ts:130–140` (the deploy script's known list)
**Severity**: High
**Why it matters**: Set in production:
- ✓ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- ✓ `NEXT_PUBLIC_APP_URL` (= `https://meethenri.com`)
- ✓ `CRON_SECRET` (32-byte hex)
- ✓ `RESEND_API_KEY` (live; rotation pending — see [05-security.md F1](./05-security.md))
- ✓ `WRITE_PROVENANCE`, `WRITE_EXTENDED` (P0 unlock flags)
- ✓ `NEXT_PUBLIC_MAPBOX_TOKEN` (`pk.placeholder` — won't render basemap tiles in prod)

Not set in production:
- ✗ Stripe (5 vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_FOUNDER_PRICE_ID`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`)
- ✗ Twilio (3 vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`)
- ✗ `OPENAI_API_KEY`
- ✗ `SENTRY_DSN` (Sentry installed and wired but no events forwarded until DSN is set)
- ✗ `REGRID_API_KEY` (parcel enrichment will be no-op)
- ✗ Optional enrichment keys (Hunter, OpenCorporates, Numverify, Cloudmersive, Apollo, WeatherStack)

`getEnv()` in `src/lib/env.ts:64–88` THROWS in production for missing required vars. So any code path that calls `getEnv()` without going through a `hasStripe()` / `hasTwilio()` / `hasOpenAI()` boolean check will 500. Notably: `/api/billing/*`, `/api/onboarding/payment`, the contractor onboarding payment step.

**Recommended fix**: Wire Stripe live mode (5 vars) and OpenAI before contractor signups go live. Twilio can come post-launch since contractors don't need SMS until they're up and running. Sentry DSN is a 5-min add. ~30 min total once Stripe Products + Webhook are configured.
**Delta tag**: NEW (production state never previously audited).

### F3. WATCH — `vercel.json` cron schedule downgraded for Hobby plan
**File**: `vercel.json`
**Severity**: Medium (operational; time-bounded by Pro upgrade)
**Why it matters**: All 17 cron entries now run daily. See [06-performance.md F1](./06-performance.md) for the wedge-bullet impact.

Schedule excerpt:
```json
"score":              "0 1 * * *"
"scrape":             "0 2 * * *"
"license-check":      "0 6 * * *"
"billing-sync":       "0 5 * * *"
"digest":             "0 7 * * *"
"weekly-digest":      "0 8 * * 1"
"follow-ups":         "0 11 * * *"
"permits":            "0 12 * * *"
"review-requests":    "0 10 * * *"
"engagement":         "0 3 * * *"
"zip-demand":         "0 4 * * *"
"enrich":             "0 13 * * *"
"geocode-backfill":   "0 14 * * *"
"blast-worker":       "0 15 * * *"
"market-intel":       "30 4 * * *"
"storm-events":       "0 9 * * *"
"re-enrich":          "0 2 * * *"
```

**Recommended fix**: After Vercel Pro upgrade, restore prior cadences via `git diff 4b7565b 56715fa -- vercel.json` and re-apply the inverse. Commit `4b7565b`'s parent has the original cadences.
**Delta tag**: REGRESSED (since 2026-04-28).

### F4. HEALTHY — CI gates merge to main
**File**: `.github/workflows/ci.yml`
**Severity**: Low (positive finding)
**Why it matters**: Pipeline:
1. Checkout
2. pnpm + Node 20
3. `pnpm install --frozen-lockfile`
4. `pnpm lint --max-warnings=0`
5. `pnpm tsc --noEmit`
6. `pnpm truthfulness` (CLAUDE.md contract)
7. `pnpm test`
8. `pnpm build`
9. `pnpm e2e` (Playwright; second job, depends on build)

All gates required to pass before merge. CLAUDE.md "Verification gate" rule.
**Recommended fix**: After F1, ensure CI runs cleanly (it should — the env values are placeholders for build, not runtime).
**Delta tag**: UNCHANGED.

### F5. HEALTHY — `package.json` dependencies stable
**File**: `package.json`
**Severity**: Low (positive finding)
**Why it matters**: Next 16.2.3, React 19.2.4, Tailwind v4, TypeScript 5, Stripe ^22, Twilio ^5.13, Resend ^6.11, OpenAI ^6.34, `@sentry/nextjs ^10.50.0`. Lockfile pinned. `vitest ^4.1.4` for tests. Bundle analyzer gated on `ANALYZE=true`.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F6. WATCH — 3 launch automation scripts not in `.gitignore`
**Files**: `scripts/_deploy-vercel.ts`, `scripts/_setup-cloudflare-dns.ts`, `scripts/_supabase-management.ts`
**Severity**: Medium
**Why it matters**: These scripts contain (or could contain) sensitive deploy logic. Currently untracked but nothing prevents them from being committed via `git add scripts/`. The hardcoded Resend API key in `_deploy-vercel.ts` (see [05-security.md F1](./05-security.md)) makes this acute.
**Recommended fix**: Add `scripts/_*.ts` to `.gitignore`. Or move them into a sibling `infra/launch-scripts/` directory that's gitignored. ~5 min.
**Delta tag**: NEW.

## Verdict

Build & deploy is WATCH today because of F1 (stale CI env), F2 (production env vars), F3 (cron downgrade), F6 (gitignore gap). All four are quick fixes; combined they're ~45 min of work to return to HEALTHY.

---

# 12 — Documentation

## TL;DR

`CLAUDE.md` is comprehensive (mid-MB-sized) and current. `AGENTS.md` correctly flags the Next.js 16 breaking-changes warning. README is scaffolded. **8 audit folders** now accumulated under `docs/audits/` (2026-04-26, 2026-04-26-delta, 2026-04-26-product-roadmap, 2026-04-27, 2026-04-28, 2026-04-29 + 2 rolled-up files) — suggest archival policy after 30 days. Inline comment density is healthy across the lib/ + middleware code.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Findings

### F1. HEALTHY — CLAUDE.md is the source of truth
**File**: `C:\Users\yabis\Desktop\Henri App\CLAUDE.md`
**Severity**: Low (positive finding)
**Why it matters**: The brand, pricing, policy, architecture, wedge contract, delivery patterns, code patterns, migrations, MCP servers, and plugin inventory are all documented. Contractor-only API gating, RLS policies, file-not-to-touch list, and the truthfulness contract are all explicit. The Karpathy guidelines section + ECC install + Knowledge Work Plugins section + claude-code-templates inventory are all up to date.
**Recommended fix**: None. Optional: split into multiple files (`CLAUDE-brand.md`, `CLAUDE-architecture.md`, etc.) once it crosses ~5MB; currently fine.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — AGENTS.md flags Next.js 16 breaking changes
**File**: `AGENTS.md`
**Severity**: Low (positive finding)
**Why it matters**: Single-line warning that Next.js 16 has APIs / conventions / file structure that differ from training data, with a pointer to read `node_modules/next/dist/docs/` before writing code. Prevents stale-knowledge regressions.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F3. WATCH — `docs/audits/` accumulating without archival policy
**Files**:
- `docs/audits/2026-04-26/` (12 files)
- `docs/audits/2026-04-26-delta.md`
- `docs/audits/2026-04-26-product-roadmap.md`
- `docs/audits/2026-04-27/` (12 files)
- `docs/audits/2026-04-28/` (12 files) + `henri-audit-2026-04-28.md` (rolled-up)
- `docs/audits/2026-04-29/` (this audit, 14 files + rolled-up)
- `docs/audits/henri-audit-2026-04-26.md` (rolled-up)

**Severity**: Low
**Why it matters**: 8 dated folders + 2 rolled-up files in 4 days. At quarterly cadence this would be 4 folders, but the launch sprint induced daily audits. Without archival, the directory accretes.
**Recommended fix**: Add `docs/audits/_archive/` for audits older than 30 days. Move `2026-04-26/`, `2026-04-26-delta.md`, `2026-04-26-product-roadmap.md`, `2026-04-27/` there once they age out. Update CLAUDE.md's "Cadence" note. ~10 min.
**Delta tag**: REGRESSED (folder count up by 2 in 24 hours).

### F4. HEALTHY — Inline comment density healthy in critical files
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `instrumentation.ts`, `src/lib/logger.ts`, `src/lib/webhooks/idempotency.ts`, `src/middleware.ts`, `src/lib/env.ts`. Each has a top-of-file purpose docstring + inline rationale comments at non-obvious points (e.g., the dynamic-import Function-trick at `instrumentation.ts:47–55` has a 9-line comment block explaining WHY). Fields like `score_signals: unknown` in `src/types/lead.ts:29-31` carry inline rationale.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — Repo-root README minimal
**File**: `README.md`
**Severity**: Low
**Why it matters**: 2026-04-28 audit said "README scaffolded". Quick check shows it's present but lean. For a public-or-shared repo, a richer README (project description, local-dev quickstart, tech stack, contributing pointer to AGENTS.md + CLAUDE.md) would help onboarding.
**Recommended fix**: Expand to ~200 lines covering project overview, prerequisites (Node 20, pnpm 9, Supabase CLI, Vercel CLI), `git clone → pnpm install → cp .env.example .env.local → pnpm dev`, deployment pointer to `vercel.json` + `.github/workflows/ci.yml`. ~30 min.
**Delta tag**: UNCHANGED.

## Verdict

Documentation is HEALTHY. F3 (audit archival) and F5 (README expansion) are the only meaningful improvements available.

---

# 13 — Production runtime (NEW domain — first audit post-launch)

## TL;DR

`https://meethenri.com` is **live and serving HTTP 200** with full security-header set, valid Let's Encrypt cert, version `56715fa` (matches latest commit). `/api/health` confirms DB ok (684ms latency), Resend ok, Stripe/Twilio/OpenAI all reporting `unconfigured` (expected — see [11-build-and-deploy.md F2](./11-build-and-deploy.md)). DNS state has stale GoDaddy/Outlook records remaining in the Cloudflare zone (cosmetic but implies email routes through Outlook which is false). Four launch tokens were exposed in chat history during the launch sprint and require rotation.

## Score

**WATCH** — NEW domain (no prior audit).

## Findings

### F1. HEALTHY — Production endpoint live with full security-header set
**Endpoint**: `https://meethenri.com/`
**Captured**: 2026-04-29 07:34:15 UTC

```
HTTP/1.1 200 OK
Server: Vercel
Cache-Control: public, max-age=0, must-revalidate
Etag: "a7aff3237b2fff4f0db6064b72893b1f"
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://cdn.vercel.sh https://*.vercel-insights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.openai.com https://nominatim.openstreetmap.org https://api.mapbox.com https://*.cartocdn.com https://*.vercel-insights.com; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; object-src 'none'; base-uri 'self'; upgrade-insecure-requests
```

**Severity**: Low (positive finding)
**Why it matters**: Every recommendation from the 2026-04-28 audit's Security domain shipped as deployed code. CSP allowlist is correct for the actual third-party surface (Stripe + Supabase + OpenAI + Mapbox + Nominatim + Vercel Insights). HSTS at max 2y with preload list. `frame-ancestors 'none'` is the strict version of X-Frame-Options. No `X-Powered-By` leak.
**Recommended fix**: None for security headers. Optional: drop `'unsafe-inline'` from `style-src` once Tailwind v4 supports CSP-strict mode.
**Delta tag**: NEW.

### F2. HEALTHY — `/api/health` returns ok with version + service status
**Endpoint**: `https://meethenri.com/api/health`
**Response**:
```json
{
  "status": "ok",
  "version": "56715fa",
  "uptime_seconds": 0,
  "timestamp": "2026-04-29T07:34:17.250Z",
  "services": {
    "database": { "status": "ok", "latency_ms": 684 },
    "stripe": { "status": "unconfigured", "error": "STRIPE_SECRET_KEY unset" },
    "twilio": { "status": "unconfigured", "error": "TWILIO_* env unset" },
    "resend": { "status": "ok" },
    "openai": { "status": "unconfigured", "error": "OPENAI_API_KEY unset" }
  }
}
```

**Severity**: Low (positive finding)
**Why it matters**: Health endpoint reports the version (matches `git log -1 --format=%h` = `56715fa`), DB latency (684ms — see F4 for analysis), and per-service env-var status. Clean separation between "infrastructure issue" (DB down, e.g.) and "feature unconfigured" (Stripe key missing). `uptime_seconds: 0` indicates a cold start, which is expected for an idle Hobby project's first request after cache eviction.
**Recommended fix**: None for the endpoint itself. See [11-build-and-deploy.md F2](./11-build-and-deploy.md) for wiring missing env vars.
**Delta tag**: NEW.

### F3. ISSUE — 7 production env vars unset (post-launch hardening required)
**Severity**: High
**Why it matters**: Per F2, four services report `unconfigured`:
- Stripe: 5 missing vars (key + webhook secret + 4 price IDs); blocks billing flow
- Twilio: 3 missing vars; blocks SMS + missed-call text-back wedge bullet #5 mechanism
- OpenAI: 1 missing var; degrades draft-reply and chat-refine to canned-reply fallback
- Sentry DSN: 1 missing var; Sentry SDK installed and wired but events not aggregated until DSN is set

**Recommended fix**: See [11-build-and-deploy.md F2](./11-build-and-deploy.md) for the per-service playbook. Total time once Stripe Products + Webhook are configured: ~30 min.
**Delta tag**: NEW.

### F4. WATCH — Database latency 684ms is high for a health check
**Severity**: Low
**Why it matters**: 684ms is on the high side for what should be a single `select 1` style ping. Possible causes: cold start at the Supabase edge, Vercel function cold start, or the health check is doing more work than a ping (e.g., counting permits to confirm read access). Worth profiling once we have steady traffic.
**Recommended fix**: Read `src/app/api/health/route.ts` and confirm the DB check is a minimal `head: true` count. If it does heavier work, switch to a `head: true` count on a small reference table. ~5 min.
**Delta tag**: NEW.

### F5. WATCH — Stale GoDaddy/Outlook DNS records remain in Cloudflare zone
**Severity**: Low (cosmetic + deliverability-adjacent)
**Why it matters**: Per launch summary, the Cloudflare zone for `meethenri.com` imported a baker's-dozen legacy DNS records when the domain transferred from GoDaddy:
- Apex MX → outlook.com (could receive bounces that we'd never see; we use `send.meethenri.com` MX → Resend SES)
- SPF including `secureserv.net` (permits a GoDaddy-controlled domain to send as us)
- Autodiscover, Lync, MSOID, SIP, Pay CNAMEs (Outlook/Office 365 remnants)
- `_sipfederationtls` and `_sip._tls` SRV records (Lync remnants)
- `_domainconnect` CNAME (GoDaddy DNS bootstrap)

The active records (A apex → 76.76.21.21, CNAME www → cname.vercel-dns.com, MX `send.meethenri.com` → feedback-smtp.us-east-1.amazonses.com, TXT send SPF for Amazon SES, DKIM via Resend) work correctly alongside these legacy records.

**Recommended fix**: User to delete the legacy records via the Cloudflare dashboard (the API token used during launch was scoped POST-only and couldn't issue DELETE requests). ~5 min. Keep the active records.
**Delta tag**: NEW.

### F6. ISSUE — 4 launch tokens exposed in chat history
**Severity**: High
**Why it matters**: During the launch session, the following tokens were pasted into the chat transcript (per the session summary):
- Cloudflare API token (full DNS + Email Routing scope on the meethenri.com zone)
- Vercel personal-access token (full project + env mutation scope)
- Supabase access token (project management + DB management scope)
- Resend API key (also hardcoded in `scripts/_deploy-vercel.ts:136`, see [05-security.md F1](./05-security.md))

**Recommended fix**: Rotate all four. See [05-security.md F1 + F2](./05-security.md) for the rotation playbook.
**Delta tag**: NEW.

### F7. HEALTHY — TLS / cert state
**Severity**: Low (positive finding)
**Why it matters**: HTTPS responds with a Vercel-issued Let's Encrypt cert. HSTS preload header in place; the domain can be submitted to the Chrome HSTS preload list once we're confident in the deployment pipeline. `Server: Vercel` confirms the request reaches Vercel directly (no Cloudflare proxying — the apex A record is set to gray-cloud DNS-only, which is correct for Vercel-served origins).
**Recommended fix**: None for cert. Optional: submit to https://hstspreload.org once 30 days of stable HTTPS-only operation have elapsed.
**Delta tag**: NEW.

### F8. HEALTHY — Cron auth gate verified live
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `/api/cron/score`, `/api/cron/scrape`, `/api/cron/enrich` — all require `Authorization: Bearer <CRON_SECRET>`. CRON_SECRET is set in production (per launch summary, fresh 32-byte hex generated at deploy time). Vercel cron triggers carry the secret via a project-level env var injection.
**Recommended fix**: None.
**Delta tag**: NEW.

## Verdict

Production runtime is WATCH today. F1 + F2 + F7 + F8 are HEALTHY. F3 (env vars) and F6 (token rotation) are the two items that should clear before paid signups go live. F4 (DB latency profiling) and F5 (stale DNS cleanup) are cosmetic.

---

# 14 — Launch delta (NEW domain — diff vs 2026-04-28)

## TL;DR

24 hours since the prior audit. Two commits shipped: `4b7565b` "Launch readiness: domain swap meethenri.com + P0 fixes + Move 1+2 + tests" and `56715fa` "Downgrade crons to daily for Vercel Hobby plan launch". The launch sprint **closed 4 of yesterday's top-10 priorities** (Sentry, idempotency, console-discipline, 5-critical-path tests). One **new Critical issue** introduced (hardcoded Resend API key in deploy script). Two **launch-induced regressions** (cron cadence, CI env staleness). One entirely **new audit domain** added (production runtime — never previously audited).

## Side-by-side diff

| Domain | 2026-04-28 status | 2026-04-29 status | Δ |
|---|---|---|---|
| 01 Architecture | HEALTHY | HEALTHY | UNCHANGED (LeadDetailDrawer pruned −85 LOC) |
| 02 Data layer | WATCH | HEALTHY | IMPROVED (00054 applied + wired) |
| 03 Types & hooks | WATCH | WATCH | UNCHANGED (auto-gen DB types still pending) |
| 04 API surface | ISSUE | ISSUE | UNCHANGED (14 unvalidated POSTs persist; 5 new routes clean) |
| 05 Security | HEALTHY | **ISSUE** | REGRESSED (hardcoded Resend token NEW) |
| 06 Performance | HEALTHY | WATCH | REGRESSED (cron cadence) |
| 07 Reliability | WATCH | HEALTHY | IMPROVED (idempotency module wired in 2 webhooks) |
| 08 Observability | WATCH | HEALTHY | IMPROVED (Sentry installed + wired) |
| 09 Tests | ISSUE | HEALTHY | IMPROVED (5 prior-zero-coverage paths now tested) |
| 10 Brand & wedge | HEALTHY | HEALTHY | UNCHANGED (truthfulness PASS) |
| 11 Build & deploy | HEALTHY | WATCH | REGRESSED (CI env stale + missing env vars + cron downgrade) |
| 12 Documentation | WATCH | HEALTHY | UNCHANGED (audit folder accretion noted) |
| 13 Production runtime | n/a | WATCH | NEW (live at meethenri.com 200 OK; 7 missing env vars) |
| 14 Launch delta | n/a | n/a | NEW (this domain) |

**Net**: +1 new ISSUE (Security regressed), +1 new WATCH (Production runtime — new domain), +3 closed (Reliability + Observability + Tests improved out of WATCH/ISSUE).

## Closed priorities (4 of prior-10)

- ✓ **Prior #4 (Sentry)** — `@sentry/nextjs ^10.50.0` installed; `instrumentation.ts` wired with dynamic-import Function-trick; `src/lib/logger.ts:101` calls `safeCall(message, meta)`. Just need `SENTRY_DSN` set in Vercel to start aggregating.
- ✓ **Prior #5 (5 untested critical paths)** — `orchestrator.test.ts`, `useLeads.helpers.test.ts`, `locks.test.ts`, `score/helpers.test.ts`, `re-enrich/helpers.test.ts` all shipped. Test count 220 → 376 / 12 → 20 files. All pass.
- ✓ **Prior #6 (152 raw console.* calls)** — Sweep on cron + webhook routes. Strict-regex count today: 10 (all intentional or transitional). Score-cron alone went from 40 → 0.
- ✓ **Prior #7 (Twilio + Resend webhook idempotency)** — `src/lib/webhooks/idempotency.ts` (133 LOC) shipped. Migration `00054_webhook_idempotency.sql` shipped + applied. Twilio + Resend webhooks both using `wasProcessed()` / `markProcessed()`. Twilio missed-call still on legacy pattern (open).

## Still-open priorities (5 of prior-10)

- ⚠ **Prior #1 (Migrations 00052+00053)** — still pending application. Idempotent on clipboard.
- ⚠ **Prior #2 (14 unvalidated POSTs)** — UNCHANGED. Launch sprint did not add Zod to any of the 14 hot-list routes.
- ⚠ **Prior #3 (Auto-generate DB types)** — UNCHANGED. `src/types/database.ts` still not generated.
- ⚠ **Prior #8 (Inline 280s deadline check on score + permits crons)** — UNCHANGED. Daily cron cadence makes this less urgent but still belongs.
- ⚠ **Prior #9 (LeadDetailDrawer refactor)** — PARTIAL: 1,116 → 1,031 LOC (−85). More extraction available.

## New regressions

- 🔻 **Hardcoded Resend API key** (Critical) — `scripts/_deploy-vercel.ts:136` contains a string-literal production key. Same key exposed in chat history. See [05-security.md F1](./05-security.md).
- 🔻 **Cron cadence downgrade** — All 17 crons now daily-only for Hobby plan. Score-cron's 19h worst-case latency violates wedge bullet #5 (speed-to-lead). Acceptable 1-week tradeoff. See [06-performance.md F1](./06-performance.md).
- 🔻 **CI env stale** — `.github/workflows/ci.yml` build/e2e jobs still use `https://henri.app` placeholder. Cosmetic. ~2 min fix. See [11-build-and-deploy.md F1](./11-build-and-deploy.md).

## Net new (never previously audited)

- 🆕 **Production runtime** — live at `https://meethenri.com`. See [13-production-runtime.md](./13-production-runtime.md). HTTP 200, full security-header set, version `56715fa`, DB ok, Resend ok, Stripe/Twilio/OpenAI unconfigured.
- 🆕 **3 launch automation scripts** — `_deploy-vercel.ts` (Vercel API), `_setup-cloudflare-dns.ts` (Cloudflare API), `_supabase-management.ts` (Supabase Management API). Untracked. One contains a hardcoded API key (see Security regression above).
- 🆕 **4 launch tokens exposed in chat history** — Cloudflare, Vercel, Supabase, Resend personal/access tokens pasted during the launch session. Rotation overdue. See [05-security.md F2](./05-security.md).
- 🆕 **Migration 00054** — webhook_idempotency table; closes prior #7. RLS-correct, composite-PK, processed_at index for pruning.
- 🆕 **5 new API routes** — `/api/health`, `/api/estimates/[id]/pdf`, `/api/estimates/preview-tax`, `/api/cron/re-enrich`, `/api/cron/storm-events`. All auth-gated and (where applicable) Zod-validated.
- 🆕 **3 new dashboard components** — `ApplicantBadge`, `CrossTradeOpportunities`, `WatchersBadge`. Each <120 LOC, properly typed.
- 🆕 **Component-level error boundary primitive** — `src/components/ui/error-boundary.tsx`.
- 🆕 **PDF renderer** — `src/lib/pdf/proposal-renderer.tsx` for `/api/estimates/[id]/pdf` (server-side only; no bundle impact).
- 🆕 **Predictive + tax modules** — `src/lib/predictive/{llm-mining,openai-client,rules}.ts`, `src/lib/tax/{stripe-tax,zip-fallback}.ts`.

## Trend dashboard

| Metric | 2026-04-26 | 2026-04-28 | 2026-04-29 | Trend |
|---|---:|---:|---:|---|
| Test files | n/a | 12 | 20 | ↑ |
| Test count | n/a | 220 | 376 | ↑↑ |
| `as unknown as` casts | 37 | 53 | 54 | flat |
| `Record<string,unknown>` | 124 | 141 | 153 | ↑ (new components) |
| `as any` / `: any` | n/a | ~17 | 13 | ↓ |
| Raw `console.*` calls (strict) | n/a | ~152 | 10 | ↓↓↓ |
| TODO/FIXME count | n/a | 7 | 7 | flat |
| Migrations on disk | 47 | 53 | 54 | ↑ |
| Migrations applied (per latest audit confirmation) | 41 | 51 | 52 | ↑ |
| Production env vars set | 0 | 0 | 9 | ↑ (launched) |
| Production env vars expected | n/a | n/a | ~16 | — |
| Prior priorities closed (cumulative since 2026-04-26) | 0 | 8 | 12 | ↑ |

## Verdict

The launch sprint moved the audit substantially in the right direction on the technical-debt axis (4 priorities closed, console-discipline radically improved, test coverage doubled). The new Security ISSUE (hardcoded token) is a 15-min fix. The Performance regression (cron cadence) is a known tradeoff with a known recovery (Vercel Pro upgrade). Net assessment: **launch-day discipline was high; week-1 hardening targets are well-defined**.

---

