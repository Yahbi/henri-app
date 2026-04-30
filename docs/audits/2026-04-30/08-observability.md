# 08 — Observability (2026-04-30)

## TL;DR

`@sentry/nextjs ^10.50.0` installed (`package.json:43`); `instrumentation.ts` wired with Function-trick dynamic import; `src/lib/logger.ts:101` `safeCall()` lit. **`SENTRY_DSN` env var still unset in production** — events queue locally without aggregation. 282 logger.* calls; 13 raw `console.*` calls (all intentional: Edge runtime + error boundaries + logger internals).

## Score

**WATCH** — UNCHANGED vs 2026-04-29 (one env-var setting away from HEALTHY).

## Findings

**O1** | **HEALTHY** | Structured logger (`src/lib/logger.ts:1-121`)
- JSON output in production, pretty in dev.
- 4 levels: `debug`, `info`, `warn`, `error`.
- `error` path forwards to optional sink via `safeCall()` (line 61-68); sink errors never break the request.
- `registerErrorSink()` (line 55) wires Sentry or other tracker.

**O2** | **HEALTHY** | `instrumentation.ts` Sentry init
- Dynamic import via Function constructor: bundler doesn't error on clean clones.
- `Sentry.init({ dsn, environment, tracesSampleRate=0.1, release })` gated on `SENTRY_DSN` env var.
- Error sink registered: `registerErrorSink((message, meta) => Sentry.captureException(...))`.
- Defensive try/catch — any boot failure leaves the app running with Sentry disabled.

**O3** | **HEALTHY** | Console discipline
- 13 raw `console.*` calls remain (was 152 on 04-28, 10 on 04-29):
  - `src/middleware.ts:66, 73` — Edge runtime can't import logger; intentional + structured JSON
  - `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/(auth)/error.tsx` — error boundary dev visibility
  - `src/app/onboarding/territory/page.tsx:1` — transitional
  - `src/lib/logger.ts:97-108` — implementation itself
  - `src/lib/log.ts:1` — older module (candidate for consolidation)
- 282 structured `logger.*` calls.

**O4** | **WATCH (CRITICAL OPEN)** | `SENTRY_DSN` env var unset in production
- **Issue**: All Sentry plumbing is complete. The only thing standing between `logger.error()` calls and a populated Sentry dashboard is the `SENTRY_DSN` env var being set in Vercel.
- **Why it matters**: Today, every production error lands only in Vercel logs (no aggregation, no alerting, no error-rate dashboards). For a launched product, this is the single biggest observability gap.
- **Recommended fix**: 
  1. Sign up free-tier Sentry account.
  2. Create project for `meethenri.com`.
  3. Copy DSN.
  4. Set `SENTRY_DSN` env var in Vercel UI (Production scope).
  5. Trigger a redeploy.
  6. Verify by triggering a known-error path (e.g. malformed POST to validated route).
  Total time: ~10 min.

**O5** | **HEALTHY** | Cron telemetry
- `src/app/api/cron/enrich/route.ts:75, 90, 295` (today's revised file) — `resetTelemetry()` at start, `getTelemetry()` snapshot at end. Per-source counters tracked: hit rate, calls, avg latency. Sorted by hit rate desc. Lets us alert on "Hunter.io hit_rate dropped to 0% overnight" or "OpenCorporates calls=0 for 24h => key revoked."

**O6** | **HEALTHY** | Health endpoint (`/api/health`)
- Reports DB latency, Resend status, Stripe status, Twilio status, OpenAI status, current commit version.
- Production verified: db ok, resend ok, stripe/twilio/openai unconfigured (expected pre-billing-flow).

**O7** | **Low** | `src/app/global-error.tsx:34` — eslint-disable comment unused
- Lint warning: "Unused eslint-disable directive (no problems were reported from 'no-console')".
- Cosmetic. Remove the disable comment OR leave it for future-proofing.

## Sentry wiring contract (recap from `src/lib/logger.ts:1-29`)

```
1. pnpm add @sentry/nextjs
2. In instrumentation.ts at the repo root, register the sink:
     import * as Sentry from "@sentry/nextjs";
     Sentry.init({ dsn: process.env.SENTRY_DSN });
     registerErrorSink((msg, meta) => {
       Sentry.captureException(new Error(msg), { extra: meta });
     });
3. Deploy — logger.error() now reports to Sentry while still printing JSON.
```

**Step 1**: ✓ done (package.json:43).  
**Step 2**: ✓ done (`instrumentation.ts`).  
**Step 3**: ✗ open (env var missing).

## Closing

Observability is in the same state as 04-29: code complete, env var missing. This is the highest-impact, lowest-effort priority for the next session. ~10 min to fully resolve.
