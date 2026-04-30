# 08 — Observability

## TL;DR

Logger is well-designed (structured JSON in prod, pretty in dev, fire-and-forget Sentry sink hook). The two open items: (1) **`@sentry/nextjs` still not installed** — sink registration code is documented in `src/lib/logger.ts:14-23` but no `instrumentation.ts` exists yet; (2) **152 raw `console.*` calls** bypass the structured logger across 75 files.

## Score

**WATCH** — both open items are mechanical: `pnpm add @sentry/nextjs` + 5-line `instrumentation.ts`, then a sed pass for `console.error → logger.error`.

## Findings

### F1. WATCH — `@sentry/nextjs` not installed
**Files**: `src/lib/logger.ts:14-23` (Sentry sink scaffolded), `package.json` (no `@sentry` dependency), no `instrumentation.ts` at repo root
**Severity**: Medium
**Why it matters**: Logger has a `registerErrorSink()` factory (line 55-57) that the Sentry init code is supposed to call. The init code is documented inline:
```ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: process.env.SENTRY_DSN });
registerErrorSink((msg, meta) => {
  Sentry.captureException(new Error(msg), { extra: meta });
});
```
Until this lands, every `logger.error()` call (count: ~50 across the codebase) only logs to Vercel's stdout. Founders can't slice errors by route/user/time without `vercel logs --follow`.
**Recommended fix**: 
1. `pnpm add @sentry/nextjs`
2. Create `instrumentation.ts` at repo root with the 5 lines above
3. Set `SENTRY_DSN` in Vercel env
~30 min total.

### F2. WATCH — 152 raw `console.*` calls bypass the structured logger
**Files**: 75 files
**Severity**: Medium
**Why it matters**: Once Sentry is wired (F1), `logger.error()` forwards to Sentry but `console.error()` does not. Top offenders by file (estimated):
- `src/app/api/cron/score/route.ts`: 40 calls (the bulk; this cron is critical)
- `src/app/api/cron/re-enrich/route.ts`: 5 calls
- `src/app/api/cron/permits/route.ts`: 4 calls
- `src/app/api/feedback/route.ts`: 6 calls (intentionally to JSONL fallback)
- `src/lib/scrapers/*.ts`: 6 calls (scrapers log per-source errors)
- Various API routes: 1-3 each (mostly `console.error("X failed:", error)`)

Vercel logs ingest unstructured text, making it hard to filter by level or field. `console.log()` in a cron is indistinguishable from an error in the Vercel UI.
**Recommended fix**: 
- For `console.error(...)` → `logger.error(...)` swap (90% of cases): `git grep -l "console.error"` + sed pass + spot-check.
- Some legitimate `console.warn` exist: `src/app/api/feedback/route.ts` (JSONL fallback marker), `src/middleware.ts:66` (god-mode audit log explicitly designed as `console.warn` because middleware runs on Edge runtime where `@/lib/logger` isn't compatible).
- ~1 hour with verification.

### F3. HEALTHY — Logger sink is fire-and-forget
**File**: `src/lib/logger.ts:59-69`
**Why it matters**: `safeCall()` wraps the sink in try/catch and never awaits. If Sentry/Datadog is down, the local log still lands, and the cron doesn't wait on a flaky network call. Any sink failure is logged via `console.warn` (not `logger.warn` — that would recurse).
**Status**: No action.

### F4. HEALTHY — Cron telemetry shipped (D3 fix)
**File**: `src/app/api/cron/enrich/route.ts:290-320`
**Why it matters**: Per-source counters (calls, hits, hit_rate, avg_latency_ms) snapshot at end-of-run, sorted by hit_rate desc, emitted in JSON response + `logger.info("enrich cron complete", summary)`. Closes prior #2.1 priority.
**Status**: Reference implementation.

### F5. HEALTHY — Logger format follows `{level, message, timestamp, ...meta}` JSON
**File**: `src/lib/logger.ts:71-79`
**Why it matters**: Production format is structured JSON; dev format is pretty `[ts] LEVEL message {meta}`. Vercel can ingest the JSON shape directly into log queries.
**Status**: No action.

### F6. WATCH — No client-side error reporting wired
**Files**: `src/app/error.tsx`, `src/app/(dashboard)/error.tsx` etc. (26 files)
**Severity**: Low
**Why it matters**: Error boundaries catch render errors but don't forward to Sentry yet. Once F1 lands, `error.tsx` files should call `Sentry.captureException(error)` to surface client-side render failures.
**Recommended fix**: After F1, update each `error.tsx` to import Sentry and capture. ~30 min.

### F7. WATCH — Audit columns inconsistent across tables
**Files**: `supabase/migrations/*.sql`
**Severity**: Low
**Why it matters**: Some tables have `created_at` + `updated_at` triggers (`leads`, `profiles`, `territories`); others just `created_at` (`permits`, `permit_sources` partially); some neither. Compliance audits often need "when was this row last modified?". Not urgent for launch.
**Recommended fix**: Defer to post-launch. Add `updated_at` (with `moddatetime` trigger) to remaining tables when CMMC/HIPAA/SOC2 prep starts.

### F8. HEALTHY — Importer logs use `console.log` deliberately
**Files**: `scripts/import-*.ts`
**Why it matters**: These run via `npx tsx`, not in Next.js server runtime. `console.log` is the right choice for one-shot scripts that emit progress to terminal. Not a violation of the structured-logger rule.
**Status**: No action.

## Diff vs 2026-04-26

### Closed
- D3 (per-source telemetry in enrich cron) — shipped this session

### Still open
- F1 (Sentry not installed) — was prior #2 priority
- F2 (152 raw console.*) — was prior #2 priority (count was 148, slight drift)
- F6 (client-side error reporting) — depends on F1
- F7 (audit columns) — defer to compliance prep
