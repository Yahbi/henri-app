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
