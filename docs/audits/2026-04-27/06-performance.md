# 06 — Performance

## TL;DR

Performance baseline holds. The new `/api/leads/count` race-with-timeout fix delivers **18-25 s → 4 ms** on the 133k-row leads table — biggest single user-facing perf improvement this session. `vercel.json` has 17 cron schedules (the new daily `/api/cron/re-enrich` at 2 a.m. UTC is in place). The persistent bottleneck remains: **migration 00043 partial indexes are pending**; without them, the burst-enrich `/api/cron/enrich` continues to risk statement timeouts on 133k+ row scans. `scripts/import-permit-archive.ts` is running in the background today; its console-based logging is acceptable for a one-off script.

## Score

**HEALTHY** — query patterns sound; missing indexes are mechanical.

## Findings

### F1 — `/api/leads/count` race-with-timeout: 18-25 s → 4 ms (NEW 2026-04-26)

- **Severity**: HEALTHY (major improvement)
- **File**: `src/app/api/leads/count/route.ts:16-101`
- **Pattern**: `Promise.race([exactPromise, 2.5s timeout])`; planner-estimate fallback when exact loses.
- **Verified**: Live response 4 ms; result `{total: 133458, geocoded: 66346}`.
- **Recommendation**: Monitor histogram of exact-wins vs. fallback. If fallback fires >90% of requests, the missing index from 00043 is the cause.

### F2 — 17 cron schedules in `vercel.json`

- **Severity**: HEALTHY
- **File**: `vercel.json:1-72`
- **New**: `/api/cron/re-enrich` daily at 2 a.m. UTC (line 68-70).
- **Cadence spread**: 5 min (blast-worker), 15 min (follow-ups, enrich, geocode-backfill), 30 min (scrape), 2 h (score), 6 h (billing-sync, permits), daily off-peak (digest, market-intel, storm-events, re-enrich).
- **Recommendation**: Document cadence rationale in a sibling `vercel.cron.md` (JSON has no comments).

### F3 — Lazy-loaded heavy libs (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: `maplibre-gl`, `recharts` remain dynamic imports.

### F4 — Server-only SDKs never reach the browser (RECONFIRMED)

- **Severity**: HEALTHY
- **Files**: `openai`, `twilio`, `stripe`, `@supabase/admin` — server-only.
- **Recommendation**: ESLint rule that fails build if these imports appear in `'use client'` files.

### F5 — No n+1 query patterns (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: PostgREST nested-select used for joins (e.g., `select: "...permits(...)"`).

### F6 — Hot routes lack rate limits (UNCHANGED)

- **Severity**: MEDIUM
- **Files**: `src/app/api/{leads/map,leads/count,intelligence,storm}/route.ts`
- **Status**: `leads/count` has `Cache-Control: private, max-age=300` (line 92), but no per-IP rate limit.
- **Recommendation**: Wire `applyRateLimit()` from `src/lib/utils/rate-limit.ts` (60 req/min/IP).

### F7 — Bundle baseline still not measured

- **Severity**: LOW
- **Recommendation**: After next `pnpm build:analyze`, capture per-route gzip sizes in `docs/perf/bundle-baseline-2026-04-27.md`.

### F8 — `import-permit-archive.ts` background script (procedural)

- **Severity**: LOW
- **File**: `scripts/import-permit-archive.ts`
- **Status**: Running today as a one-off bulk loader. Console-based logging is appropriate for a script. Resumable via `.import-state.json` checkpoint.
- **Recommendation**: If operationalized as a recurring job, migrate to `src/lib/logger.ts`.

### F9 — Burst-enrich blocked on missing 00043 indexes (UNCHANGED)

- **Severity**: HIGH
- **File**: `supabase/migrations/00043_enrich_indexes.sql` (pending)
- **Why**: Partial indexes on `(year_built IS NULL)`, `(owner_name IS NULL)`, `(phone IS NULL)`, geocoded composite. Without them, full-table scans hit statement timeout on 133k+ leads.
- **Recommendation**: Apply via `_pending-bundle.sql` (see 02 F1).

### F10 — `maxDuration` settings correct across cron (RECONFIRMED)

- **Severity**: HEALTHY
- **Pattern**: Most crons `maxDuration = 300` with 280s internal deadline; fast crons use 60-120s.
- **Status**: Consistent.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F6 | Wire rate-limit to 4 hot routes | 1 h | No |
| F7 | Capture bundle baseline | 30 min | No |
| F9 | Apply 00043 partial indexes | 5 min (via bundle) | Yes |
