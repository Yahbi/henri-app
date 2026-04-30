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
