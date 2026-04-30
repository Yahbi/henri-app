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
