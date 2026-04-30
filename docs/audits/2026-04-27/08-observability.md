# 08 — Observability

## TL;DR

Observability scaffolding is **production-ready**. `instrumentation.ts` is now tracked and properly wired (was untracked at baseline). Sentry adapter is complete: setting `SENTRY_DSN` in Vercel env auto-forwards every `logger.error()` to Sentry. The structured logger (`src/lib/logger.ts`) is the canonical primitive. The pressing gap remains **~150 raw `console.*` calls** in source that bypass the logger and won't forward to Sentry — same as baseline (mechanical 2-hour cleanup).

## Score

**WATCH** — scaffolded complete, env var + 2 h cleanup until Phase 5 done.

## Findings

### F1 — Structured logger production-ready (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/lib/logger.ts:1-121`
- **Status**: JSON in prod, pretty in dev; error path forwards to registered sink.

### F2 — Sentry sink wired (NOW COMPLETE)

- **Severity**: RESOLVED (was MEDIUM at baseline)
- **File**: `instrumentation.ts:42-85`
- **What's in place**:
  - `SENTRY_DSN` env-gate
  - `Function`-constructor wrapper for the dynamic import (hardened 2026-04-26)
  - `Sentry.init({ dsn, environment, tracesSampleRate: 0.1, release: gitSha })`
  - `registerErrorSink((message, meta) => Sentry.captureException(...))`
  - Defensive try/catch — boot failure doesn't break the app
- **Next step**: Set `SENTRY_DSN` in Vercel env vars + deploy. 5 minutes to full observability.

### F3 — `logApiError()` sanitizes errors (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/lib/log.ts`
- **Status**: Used in 50+ route handlers; prevents PII / secret leak.

### F4 — ~150 raw `console.*` calls in `src/` (UNCHANGED)

- **Severity**: MEDIUM
- **Status**: Mechanical 2-hour cleanup remains. Bypasses logger; won't forward to Sentry.
- **Recommendation**: Phase 5 — replace with `logger.*`, add ESLint `no-console` rule (exempt `logger.ts`/`log.ts`).

### F5 — Cron telemetry is per-batch, not per-item (UNCHANGED)

- **Severity**: LOW
- **Status**: Cron logs "processed N, failed M"; per-item traces gated on `LOG_ENRICHMENT_DETAIL=1`.
- **Recommendation**: Acceptable; flip the flag when debugging specific lead skip cases.

### F6 — No request-trace correlation IDs (UNCHANGED)

- **Severity**: MEDIUM
- **Recommendation**: Generate UUID per route handler, thread as `meta.trace_id` to all logger calls. After Sentry: `Sentry.Scope.setTag("trace_id", id)`.

### F7 — No business-metric instrumentation (UNCHANGED)

- **Severity**: MEDIUM
- **Recommendation**: Phase 5 — author `src/lib/metrics.ts` with `track(event, props)` to PostHog/Mixpanel/Supabase events table.

### F8 — Cron logs don't differentiate "success" vs. "no work" (UNCHANGED)

- **Severity**: LOW
- **Recommendation**: Each cron emits `logger.info("cron complete", { route, processed_count, failed_count, duration_ms })` at the end.

### F9 — `instrumentation.ts` is tracked + documented (NOW FIXED)

- **Severity**: RESOLVED (was LOW at baseline)
- **Status**: 86 lines of intentional code with comprehensive doc comments explaining how to enable each tracker.

### F10 — No client-side error tracking (UNCHANGED)

- **Severity**: MEDIUM
- **Recommendation**: After server-side Sentry wired, add `instrumentation-client.ts` and wire `error.tsx` boundaries to call `Sentry.captureException(error)`.

### F11 — Audit + import scripts use `console.*` (procedural)

- **Severity**: LOW
- **Files**: `scripts/_session-data-audit.ts` (~18 calls), `scripts/import-permit-archive.ts` (~15 calls)
- **Status**: Acceptable for one-off scripts; flag if operationalized.

### F12 — Sentry telemetry properly gated (positive)

- **Severity**: HEALTHY
- **Status**: `SENTRY_DSN` env-gate, `NEXT_RUNTIME` runtime-gate (skip Edge), `tracesSampleRate=0.1` (10%), release tag = git SHA, defensive try/catch.

## Phase 5 next steps

1. Set `SENTRY_DSN` in Vercel env + deploy (5 min) — instant observability.
2. Replace ~150 `console.*` with `logger.*` (2 h mechanical).
3. Add ESLint `no-console` rule.
4. Thread request-trace IDs.
5. Wire client-side `instrumentation-client.ts` for `error.tsx` boundaries.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F2 next | Set `SENTRY_DSN` + deploy | 5 min | No |
| F4 | Replace console.* with logger.* | 2 h | No |
| F6 | Add request-trace IDs | 2 h | No |
| F10 | Wire client-side Sentry | 1 h | No (after F2 next) |
