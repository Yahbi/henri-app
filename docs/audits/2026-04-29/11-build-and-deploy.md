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
