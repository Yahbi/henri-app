# 08 — Observability

## TL;DR

Foundations are in place: a structured logger (`src/lib/logger.ts`) with JSON-in-prod / pretty-in-dev formatting, an error-sink scaffold ready for Sentry (or any tracker) without touching call sites, and a sanitizing `logApiError()` helper used in 50+ route handlers. The pressing gap is **no error tracker is wired** — the sink is registered as a no-op. Once the user adds `@sentry/nextjs` and the 5-line init in `instrumentation.ts`, every `logger.error()` call site instantly forwards to Sentry. Until then, error visibility is "skim Vercel logs".

## Score

**WATCH** — scaffolded for production observability, just needs the last 5-line wiring step.

## Findings

### F1 — Structured logger exists and is production-ready

- **Severity**: Nitpick (positive)
- **File**: `src/lib/logger.ts`
- **Why it matters**: JSON output in production (Vercel log ingestion-friendly), pretty output in dev. Drop-in replacement for `console.error`. Error path forwards to a registered sink (no-op until Sentry wired) AND prints the structured line — so even without a tracker, logs are queryable.
- **Recommendation**: None. This is the canonical observability primitive.

### F2 — Error sink scaffold ready for Sentry

- **Severity**: Medium (high-priority unblocker)
- **File**: `src/lib/logger.ts:42-69`, no `instrumentation.ts` exists yet
- **Why it matters**: The sink is a 1-line registration:
  ```ts
  registerErrorSink((msg, meta) => Sentry.captureException(new Error(msg), { extra: meta }));
  ```
  Once wired, every `logger.error()` call site forwards to Sentry. Without this, production errors are visible only by reading Vercel logs — easy to miss, no aggregation, no per-user trace.
- **Recommendation**: Phase-5 launch hardening task. Add `pnpm add @sentry/nextjs`, create `instrumentation.ts` at repo root, register the sink, configure `SENTRY_DSN` env var. The logger module's doc-comment (lines 14-29) walks through this exactly. Estimated: 30 minutes.

### F3 — `logApiError()` sanitizes error objects

- **Severity**: Nitpick (positive)
- **File**: `src/lib/log.ts`
- **Why it matters**: When an API route catches an error, sending the raw error to logs can leak PII or secrets (e.g., a Postgres error message containing the full SQL query with a phone number in a WHERE clause). `logApiError(operation, err, extra)` strips this. Per security-agent: used in 50+ routes.
- **Recommendation**: None. Add to `12-documentation.md` as the canonical "log an API error" pattern.

### F4 — 148 raw `console.*` calls in source

- **Severity**: Medium
- **File**: 74 files (per grep) — top offenders: `lib/sequences/engine.ts` (7), `api/intake/route.ts` (6), `api/feedback/route.ts` (6), `api/reviews/route.ts` (7), `api/outreach/route.ts` (5), `api/quotes/route.ts` (5)
- **Why it matters**: 148 raw `console.log` / `console.warn` / `console.error` calls bypass the structured logger. They produce unstructured Vercel log lines (no `level` field, no `timestamp`, no extra metadata). When the Sentry sink lands (per F2), these errors WON'T forward to Sentry because they don't go through `logger.error()`.
- **Recommendation**: Sweep the 74 files, replace `console.*` with `logger.{debug,info,warn,error}` from `src/lib/logger.ts`. ~2 hours of mechanical work. Add an ESLint rule (`no-console`) and exempt only `src/lib/logger.ts` itself + `src/lib/log.ts`.

### F5 — Cron telemetry is per-batch counters, not per-item traces

- **Severity**: Low
- **File**: `src/app/api/cron/enrich/route.ts`, `src/app/api/cron/score/route.ts`
- **Why it matters**: The crons log "processed N, failed M" at the end of each batch. They don't per-item trace which permits failed and why. Debugging "why did this lead skip enrichment" requires re-running locally with verbose logging.
- **Recommendation**: Add a structured `logger.warn("enrichment skipped", { lead_id, source, reason })` per skip, gated by a `LOG_ENRICHMENT_DETAIL=1` env var so prod doesn't drown. When debugging a specific lead, flip the flag for one cron run and grep the logs.

### F6 — No request-trace correlation IDs

- **Severity**: Medium
- **File**: All API routes
- **Why it matters**: When a user reports "I clicked save and got an error", finding the matching server log requires guessing the timestamp + filtering by user. Adding a request-trace ID (`x-request-id` header on response, threaded through into every `logger.*` call from that request) makes correlation trivial. Also helps when a single user action triggers a chain of cron jobs / webhooks downstream.
- **Recommendation**: Generate a UUID at the top of each route handler, pass it as `meta.trace_id` to every logger call within that handler. When Sentry is wired, use Sentry's `Scope.setTag("trace_id", id)` so the trace_id appears in the dashboard.

### F7 — No business-metric instrumentation

- **Severity**: Medium
- **File**: N/A — no metrics module
- **Why it matters**: Henri runs a B2B SaaS with key business metrics: signup → onboarding completion rate, plan-tier conversion, lead-claim rate, time-to-first-lead. None of these are emitted as structured events; the team would derive them from raw DB queries on demand. That works at Beta scale (100 users) but doesn't scale.
- **Recommendation**: Phase-5 hardening. Add `src/lib/metrics.ts` with `track(event, props)` that emits to PostHog / Mixpanel / a Supabase `events` table. Instrument the 6 key business events. Defer until launch.

### F8 — Vercel cron logs don't differentiate "success" from "no work"

- **Severity**: Low
- **File**: All `src/app/api/cron/*/route.ts`
- **Why it matters**: A successful cron run with zero work to do (no permits to enrich, no scores to update) looks identical to a successful run that processed 200 items. From the Vercel logs you can't tell if the system is healthy-but-idle or healthy-and-busy without reading the body.
- **Recommendation**: Each cron should log a single structured `logger.info("cron complete", { route, processed_count, failed_count, duration_ms })` line at the end. Then a Vercel log alert "no `cron complete` for 30 minutes" catches stuck/failing crons.

### F9 — `instrumentation.ts` was added (untracked) — is it doing anything?

- **Severity**: Low
- **File**: Per `git status`: `?? instrumentation.ts` (untracked)
- **Why it matters**: `instrumentation.ts` is the Next.js entry point for OTel / Sentry / startup hooks. It exists in the working tree but isn't tracked. Either it's a stub from `pnpm dlx` install, or it's a half-done Sentry wiring that didn't land.
- **Recommendation**: Read it, complete it, commit it. If it's empty, delete it.

### F10 — No client-side error tracking

- **Severity**: Medium
- **File**: `src/app/error.tsx`, `src/app/(dashboard)/error.tsx`, etc.
- **Why it matters**: Server errors flow through the structured logger. Client-side render errors (e.g., a NaN in a chart, a stale ref dereferenced) trigger the segment `error.tsx` but only `console.error` to the browser console — they don't reach Vercel logs OR Sentry. A silent JS bug on a hot dashboard tab is invisible.
- **Recommendation**: After Sentry is wired (F2), add `Sentry.init()` to a client `instrumentation-client.ts` (Next.js 16 supports this). The `error.tsx` boundary can call `Sentry.captureException(error)` in its `useEffect`.

### F11 — `console.error` in `src/app/error.tsx` is correct fallback

- **Severity**: Nitpick (positive)
- **File**: `src/app/error.tsx`, `src/app/(auth)/error.tsx`
- **Why it matters**: The error boundaries call `console.error` to log the error to the browser console. This is correct for client-side React errors — even before Sentry, the developer can reproduce by opening DevTools.
- **Recommendation**: After Sentry wired, additionally call `Sentry.captureException(error)` in the boundary's `useEffect`.

## What's working well

- **Structured logger exists** (`src/lib/logger.ts`) with JSON / pretty switching.
- **Error sink scaffold** ready for Sentry — no codepath changes needed when wiring.
- **`logApiError()` sanitizes** error objects (no PII / secret leak).
- **Hierarchical error.tsx** at every route segment.
- **Feedback route's local-JSONL fallback** doubles as a poor-man's "we tried" audit trail when DB and email both fail.
