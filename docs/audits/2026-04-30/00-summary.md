# 00 — Summary, scorecard, top-10 (2026-04-30)

**Generated**: 2026-04-30 — single-day audit covering commit `1437f86` ("audit-04-30: 4 user-reported fixes"). Diff baseline: [henri-audit-2026-04-29.md](../henri-audit-2026-04-29.md).

**Methodology**: 3 parallel Explore agents (architecture+data, security+API+auth, perf+reliability+tests+observability) plus targeted reads of `src/middleware.ts`, `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/auth/requireContractor.ts`, `next.config.ts`, `vercel.json`, `package.json`, `.github/workflows/ci.yml`. Verification at audit start: `pnpm tsc --noEmit` exit 0 · `pnpm vitest run` 428/428 pass / 22 files / 4.23s · `pnpm truthfulness` PASS · `pnpm lint --max-warnings=0` exit 1 (18 errors / 13 warnings — pre-existing, all in `scripts/_archive/*.ts`, `scripts/_recompute-*.ts`, `src/app/global-error.tsx:130`, `src/hooks/useDrawerResize.ts:166`; none in commit `1437f86`'s 14 files). `git status --short` 100+ untracked entries (audit artefacts + screenshots + scripts; no shipping-code modifications).

## Executive scorecard

| # | Domain | Status | Δ | Top issue (this audit) |
|---|---|---|---|---|
| 01 | [Architecture](./01-architecture.md) | HEALTHY | UNCHANGED | LeadDetailDrawer 1031 → 374 LOC (refactor complete); ChatIntakeModal split 1028 → 581 + 545 LOC (steps extraction). dashboard/page.tsx 666 LOC with 18× `as unknown as` casts (highest cluster). |
| 02 | [Data layer](./02-data-layer.md) | HEALTHY | IMPROVED | 58 migrations (was 54); `00055_lead_property_context_views`, `00056_cost_benchmarks_rls`, `00057_security_advisor_fixes`, `00058_security_definer_lockdown`, `00059_revoke_public_execute`, `00060_lock_materialized_views` all applied. Documented gaps at 00037→00039 + 00047→00050 unchanged. |
| 03 | [Types & hooks](./03-types-and-hooks.md) | WATCH | REGRESSED | `as unknown as` 54 → 58 (+4, all in dashboard/page.tsx feature accretion); `Record<string, unknown>` 153 → 158 (+5); `as any` 15 → 14 (−1). Hooks discipline HEALTHY: 34 hooks, all cancellation-safe. |
| 04 | [API surface](./04-api-surface.md) | HEALTHY | IMPROVED | **All 14 unvalidated POSTs from 04-29 now validated** (Zod via `validateRequestBody()` / `parseBody()`). 103 routes total (was 98+). 8 outbound email routes refactored to canonical `support@meethenri.com` with `reply_to` set (commit `1437f86`). |
| 05 | [Security](./05-security.md) | HEALTHY | IMPROVED | **Resend leak from 04-29 closed** (`scripts/_deploy-vercel.ts` now reads `process.env.RESEND_API_KEY`). LLM injection defenses HEALTHY (delimiter-quoted, 2000-char cap on `/api/ai/draft-reply`). Stripe + Twilio (status) idempotency HEALTHY. **Twilio missed-call** still missing `wasProcessed()` guard. |
| 06 | [Performance](./06-performance.md) | WATCH | IMPROVED | Enrichment cron throttle bumped (BATCH_SIZE 600→1200 / CONCURRENCY 4→6 / 4 daily slots). 4,800 leads/day capacity (was ~600). **Cron-slot collision at 14:00 UTC**: enrich + geocode-backfill share the slot — recommend moving geocode to 14:30. |
| 07 | [Reliability](./07-reliability.md) | HEALTHY | UNCHANGED | Graceful-degrade patterns intact: `/api/feedback` (DB → email → JSONL), `/api/exclusivity` (table-missing → empty summary), `useLeads` (extended-columns fallback). Webhook idempotency module wired into Stripe + Twilio (status) + Resend; **twilio-missed-call still TODO** (priority #2 from 04-29 still open). |
| 08 | [Observability](./08-observability.md) | WATCH | UNCHANGED | `@sentry/nextjs ^10.50.0` installed, `instrumentation.ts` Function-trick wired, `src/lib/logger.ts:101` `safeCall()` lit. **`SENTRY_DSN` env var still unset in production** — events still queue locally. 282 logger.* calls; 13 raw `console.*` (all intentional: middleware Edge runtime + error boundaries + logger internals). |
| 09 | [Tests](./09-tests.md) | WATCH | IMPROVED | 376 → 428 tests / 20 → 22 files (+52 tests). 3 critical paths still untested: **score-signal-writer** (`src/lib/scoring/signals.ts`), **capacity-filter** (`src/lib/capacity/types.ts`), **twilio-missed-call** (`src/app/api/webhooks/twilio-missed-call/route.ts`). All on the same backlog as 04-29. |
| 10 | [Brand & wedge](./10-brand-and-wedge.md) | HEALTHY | UNCHANGED | Truthfulness scan PASS (only pricing strings outside `/pricing` are the canonical signup chips at `src/app/(auth)/signup/page.tsx:50-53`, all matching CLAUDE.md). 6 wedge bullets all implemented end-to-end. Brand tokens locked. Magic-link auth + Google OAuth dual-provider live. |
| 11 | [Build & deploy](./11-build-and-deploy.md) | WATCH | IMPROVED | CI workflow `NEXT_PUBLIC_APP_URL` placeholder corrected to `https://meethenri.com` (was `https://henri.app` in 04-29; now fixed at line 50). vercel.json 17 → 20 crons (4 enrich slots). **GitHub Actions CI failing** on `lint --max-warnings=0` (18 errors, pre-existing in `scripts/_archive/*.ts` + `useDrawerResize.ts:166` set-state-in-effect). |
| 12 | [Documentation](./12-documentation.md) | HEALTHY | UNCHANGED | CLAUDE.md comprehensive (now ~600 lines after 04-29 expansion). 9 audit folders accumulated under `docs/audits/`; archival policy still pending. AGENTS.md + per-skill READMEs intact. |

**Overall verdict**: Henri continues to harden incrementally. **The 04-29 backlog has shifted dramatically toward "done"**: 14 unvalidated POSTs all closed, leaked Resend token closed, CI domain placeholder closed, Sentry plumbing already complete (just needs DSN env var). Today's commit `1437f86` shipped 4 user-facing UX fixes (homeowner intake skip-zip, pipeline drag-drop race, email canonical FROM, enrichment cron 8× throughput) with 428/428 tests passing and live verification on production. **Three items remain priority for the next session**: (1) wire `SENTRY_DSN` in Vercel env; (2) add `wasProcessed()` to twilio-missed-call; (3) cover the 3 still-untested critical paths.

## Top 10 priorities (ordered impact × effort)

1. **Wire `SENTRY_DSN` in Vercel env** — `@sentry/nextjs ^10.50.0` is installed, `instrumentation.ts` is configured, the logger sink is lit. Setting one env var in Vercel UI activates the entire 282-call error pipeline. Free-tier covers launch volume. ~5 min. [08-observability.md O12](./08-observability.md)

2. **Move `geocode-backfill` cron from 14:00 → 14:30** — `vercel.json:53` and `vercel.json:65` both fire at 14:00 UTC. Enrich now processes 1200 leads / 100s typical / 240s worst case at that slot; geocode-backfill is geocoding-bound. Concurrent runs risk Supabase connection pool pressure. 1-line move. [06-performance.md P2](./06-performance.md)

3. **Add `wasProcessed()` guard to twilio-missed-call webhook** — `/api/webhooks/twilio-missed-call/route.ts` is the last webhook route still missing the idempotency abstraction. Twilio redeliveries currently insert duplicate `missed_call_events` rows + send extra auto-reply SMS. Pattern matches `/api/webhooks/twilio/route.ts:44-62`. ~30 min copy-paste. [07-reliability.md R3](./07-reliability.md)

4. **Cover the 3 still-untested critical paths**:
   - `src/lib/scoring/signals.ts` — `buildScoreSignalBreakdown()` powers the transparency drawer (wedge bullet #2). One bad regex silently breaks the UI. ~3 hours.
   - `src/lib/capacity/types.ts` — `isCapacityPrefs()` + `hasActivePrefs()` type guards underpin the capacity filter (wedge bullet #3). ~1 hour.
   - `src/app/api/webhooks/twilio-missed-call/route.ts` — signature validation + form-urlencoded parsing path. ~2 hours.
   [09-tests.md T1, T2, T3](./09-tests.md)

5. **Auto-generate DB types via Supabase MCP** — repeated finding from 04-26, 04-28, 04-29. Today: 58 `as unknown as` casts (+4 vs yesterday, all in `dashboard/page.tsx`). Run `mcp__supabase__generate_typescript_types` → `src/types/database.ts`, then refactor `useLeads.helpers.ts` (3 casts) and `dashboard/page.tsx` (18 casts). Cuts ~50% of the cast count. ~2 hours. [03-types-and-hooks.md F1](./03-types-and-hooks.md)

6. **Refactor `src/hooks/useDrawerResize.ts:166` to lift state derivation out of `useEffect`** — the React 19 lint rule `react-hooks/set-state-in-effect` now fires hard. Current code calls `setLocalHeight()` synchronously inside `useEffect` body, which can cause cascading renders. Pattern: move the derivation to a `useMemo` that reads `height + minHeight` directly. ~30 min. [11-build-and-deploy.md F1](./11-build-and-deploy.md)

7. **Replace `<a>` with `<Link />` in `src/app/global-error.tsx:130`** — `@next/next/no-html-link-for-pages` lint error. Single line change. ~2 min. [11-build-and-deploy.md F2](./11-build-and-deploy.md)

8. **Plan migration `00061_rls_initplan_perf_pass.sql`** — Supabase advisor still reports 54 RLS initplan WARN + 21 multiple-permissive policy WARN. Each `auth.uid()` call inside an RLS policy is re-evaluated per row; rewriting as `(SELECT auth.uid())` evaluates once. Single dedicated migration; 1-2 hours; large query-perf win. [02-data-layer.md F1](./02-data-layer.md), [06-performance.md P3](./06-performance.md)

9. **Document the 00037→00039 + 00047→00050 migration numbering gaps** in CLAUDE.md — same recommendation as 04-29. The gap doesn't break anything (numbering is for human ordering, not Postgres) but every audit will keep flagging it as a "trust me" smell. Either restore the missing files from git history or add a one-paragraph note in CLAUDE.md's "Migrations" section. ~10 min. [02-data-layer.md F2](./02-data-layer.md)

10. **Apply migration `00061_rls_initplan_perf_pass`** (after item #8 designs it) — same time-and-place as the schedule above; bundles with #8.

## What blocks scaling

Of the 10 priorities, the **gating items before high-volume traffic** are:

- **#1** — `SENTRY_DSN` unset means every production error currently lands only in Vercel logs (no aggregation, no alerting, no error-rate dashboards). Critical for launch traffic monitoring.
- **#3** — Twilio missed-call without idempotency means the speed-to-lead path (wedge bullet #5) is double-firing on Twilio retries. Acceptable today (low volume); becomes user-visible noise at scale.
- **#8** — RLS initplan on every lead-list query under load multiplies the `auth.uid()` cost by row count. At 1000 leads × 1 cold-cache fetch per dashboard load × 10 contractors, that's an extra ~10k unnecessary auth calls per minute peak.

Everything else is engineering polish.

## What's working well (audit-wide positives)

- **Production is live and serving** at `https://meethenri.com` with HTTP 200, full security-header set, valid certificate.
- **Today's deploy verified live** — commit `1437f86` `/portal` flow tested on production: ZIP `06112` → "Find my contractor" → "Roofing" → lands directly on Step2 (Timeline), back-nav rewinds correctly with selection preserved.
- **All 14 unvalidated POSTs are closed** — the single biggest 04-29 backlog item is gone. Every POST handler that takes JSON now has a Zod schema.
- **Webhook idempotency abstraction is widely adopted** — Stripe (event.id), Twilio status (`messageSid:status`), Resend (`svix-id`) all dedupe. Only twilio-missed-call remains.
- **Email canonical compliance** — 0 `noreply@meethenri.com` references in `src/`. All 8 customer-facing/contractor-broker email sends now route replies to `support@meethenri.com`.
- **Enrichment throughput 8× boost** — `BATCH_SIZE` 600→1200, `CONCURRENCY` 4→6, 4 daily slots. 165k stale-lead backlog now clears in ~35 days vs. ~275 days at the prior rate.
- **Test discipline holds** — 22 files / 428 tests, all passing in 4.23s. Vitest 4.1.4. No flaky tests.
- **Brand discipline holds** — truthfulness scan PASS; no `#E8916A` references; no `font-bold` on Fraunces; no emojis; pricing tiers exact (`$149` / `$749` / `$1,499` / `$2,555`); "Henri." with period in nav.
- **CSP / HSTS / X-Frame / X-Content-Type / Referrer / Permissions / X-DNS-Prefetch all present** in `next.config.ts:60-74` and confirmed live on production curl.
- **Magic-link + Google OAuth dual-provider** unblocks Outlook/Yahoo/corporate-email contractors per the 04-29 brand-rule amendment.

## Verification gate (current state)

- `pnpm tsc --noEmit` → exit 0
- `pnpm vitest run` → 428 / 428 / 22 files / 4.23s
- `pnpm truthfulness` → PASS / TRUTHFULNESS_OK
- `pnpm lint --max-warnings=0` → exit 1 (18 errors / 13 warnings, all pre-existing — see 11-build-and-deploy.md F1, F2)
- `git status --short` → 100+ entries (audit + screenshots + ingest scripts; no shipping-code mods uncommitted)
- Production live verification — meethenri.com/portal flow #1 (skip-zip + back-nav) confirmed working at 07:37 UTC

## Diff vs 2026-04-29

### Closed (5 of 10 prior priorities)
- ✓ Resend API token rotation (prior #1) — `scripts/_deploy-vercel.ts:24` now reads `process.env.RESEND_API_KEY`; key rotated; production env var updated
- ✓ 14 unvalidated POST routes (prior #2) — every flagged route now has a Zod schema via `parseBody()` / `validateRequestBody()`
- ✓ CI workflow domain placeholder (prior #6) — `.github/workflows/ci.yml:50` now `https://meethenri.com`
- ✓ Cron cadence on Vercel Pro (prior #7) — Pro plan upgrade complete; today's `vercel.json` schedules 20 daily-or-finer crons
- ✓ Today (NEW): homeowner intake double-zip + back-nav (`src/components/portal/ChatIntakeModal*`), pipeline drag-drop state race (`KanbanBoard.tsx`), email canonical FROM (8 routes), enrichment 8× throughput (`/api/cron/enrich/route.ts` + `vercel.json`)

### Still open
- ⚠️ Sentry DSN env var unset (prior #3 partial — code complete, env var missing)
- ⚠️ Auto-generated DB types not started (prior #5)
- ⚠️ Twilio missed-call idempotency wrap (prior #8)
- ⚠️ 3 still-untested critical paths (prior #9 — same 3)
- ⚠️ Migration numbering gaps 00037→00039 + 00047→00050 (prior #10)

### New regressions
- 🔻 `as unknown as` count 54 → 58 (+4, all in `dashboard/page.tsx` feature accretion — type-gen migration would close this)
- 🔻 vercel.json cron-slot collision at 14:00 UTC (enrich + geocode-backfill) — surfaced today as a side-effect of the 4-slot enrich expansion
- 🔻 `Record<string, unknown>` 153 → 158 (+5, similar driver as the cast bump)

### Net new
- 🆕 BackLink component pattern in `src/components/portal/ChatIntakeModal.steps.tsx:128-138` — clean, reusable, on-click-only handler
- 🆕 `dataTransfer.application/x-henri-lead` payload contract in `KanbanBoard.tsx:362-410` — eliminates dragend-vs-drop race; documented inline

## Next audit

Re-run weekly through 2026-05-31, then quarterly. Suggest moving older audits (04-26, 04-27 if it exists) to `docs/audits/_archive/`. Today's snapshot lives in [./](./).
