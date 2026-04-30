# 06 — Performance

## TL;DR

Cron architecture is fault-tolerant: deadline-enforced, work-stealing queue, polite vendor rate-limits, per-source telemetry (D3 fix shipped). Query patterns in hooks are paginated and bounded. The two open WATCH items are: (1) **`useLeads` partial-result-on-page-timeout silently logs to `console.warn`** (will become invisible when Sentry lands without a `logger.warn` swap), and (2) **`/api/cron/score` and `/api/cron/permits` lack inline 280s deadline enforcement** (only `/api/cron/enrich` has it).

## Score

**HEALTHY** — only 2 small reliability improvements remain to close the loop.

## Findings

### F1. HEALTHY — Cron deadline enforcement + per-item try/catch (enrich)
**Files**: `src/app/api/cron/enrich/route.ts:159-285`, `src/app/api/cron/re-enrich/route.ts`
**Why it matters**: CLAUDE.md "graceful degradation" wedge. Both crons implement work-stealing queue, deadline (`t0 + 280_000`, 20s headroom under Vercel's 300s kill), per-lead try/catch isolation, polite per-worker rate limit (`REQ_INTERVAL_MS=500` × 4 workers = 8 req/s global).
**Status**: Reference implementation.

### F2. HEALTHY — Polite rate limits on free vendors confirmed
**Files**: `src/app/api/cron/enrich/route.ts:56-57`
**Why it matters**: County GIS endpoints + Numverify (100/mo) + Cloudmersive (800/mo) require measured pacing to avoid bans/overages. Math is documented inline (lines 41-43) — at concurrency 4 with 500ms interval per worker, global rate is 8 req/s.
**Status**: No regressions.

### F3. HEALTHY — D3 telemetry (per-source hit rate) emitted
**File**: `src/app/api/cron/enrich/route.ts:290-320`
**Why it matters**: D3 fix earlier this session — `getTelemetry()` snapshot per-source (calls, hits, hit_rate, avg_latency_ms), sorted by hit_rate desc, emitted in JSON response + `logger.info("enrich cron complete", summary)`. Lets the founder answer "is Hunter.io / FEC / OpenCorporates contributing?" without cracking open every lead's sources object.
**Status**: Closes prior #2.1 priority.

### F4. WATCH — `/api/cron/score` and `/api/cron/permits` lack inline 280s deadline check
**Files**: `src/app/api/cron/score/route.ts`, `src/app/api/cron/permits/route.ts`
**Severity**: Medium
**Why it matters**: Both have `maxDuration = 300` but no inline early-exit. Per-iteration loop (e.g. permit-by-permit scoring) could overrun 300s and hit Vercel's hard kill, leaving partial state. `/api/cron/enrich` is the reference implementation (line 160-275: `const deadline = t0 + 280_000` checked at every worker iteration).
**Recommended fix**: Add `const deadline = Date.now() + 280_000` to both, check inside the per-permit / per-source loop. ~30 minutes.

### F5. WATCH — `useLeads` silently logs partial results on page timeout
**File**: `src/hooks/useLeads.ts:222-229`
**Severity**: Low
**Why it matters**: Multi-page fetch (god-mode 5k+ leads) reconstructs query per page, retries once on missing-column, but if a later page times out it returns partial results with `console.warn`. Vercel logs ingest unstructured text; once Sentry is wired (priority #4), this signal will be invisible because `console.warn` is not in the structured logger pipeline.
**Recommended fix**: Replace `console.warn` with `logger.warn` (`@/lib/logger`). Once Sentry is wired, partial-result events become aggregatable.

### F6. NITPICK — `useLeads` rebuilds filter query 4× in pagination loop
**File**: `src/hooks/useLeads.ts:187-218`
**Severity**: Low
**Why it matters**: Per-page query builder reconstructs filters from scratch (PostgREST builders are single-use). Not a perf hit on realistic data (50-1000 leads/page) but makes refactoring brittle.
**Recommended fix**: Extract `buildLeadsQuery(supabase, godMode, userId, filters)` helper. ~30 min.

### F7. HEALTHY — Importer scripts use recursive batch-halving on Supabase 522s
**Files**: `scripts/import-live-master.ts:upsertChunk`, `scripts/import-master-json.ts:upsertChunkWithRetry`
**Why it matters**: Supabase's PostgREST is Cloudflare-fronted; large bulk upserts trigger 522 "upstream request timeout" or 57014 statement-timeout. The helper halves the chunk and retries, bottoming out at chunk size 10. New importers all use the pattern.
**Status**: New session-added; pattern is consistent.

### F8. HEALTHY — `useLeads` pagination is correct
**File**: `src/hooks/useLeads.ts:80-234`
**Why it matters**: Single-page (`limit ≤ 1000`) uses `.range(startOffset, startOffset + limit - 1)` with stable tiebreaker on `id`. Multi-page (`limit > 1000`) iterates with PAGE_SIZE=1000, dedups via `Map<id, row>` after collection. Correctness is preserved across page boundaries.
**Status**: No regressions.

### F9. WATCH — Bundle size top files (refactor candidates from 01-architecture.md)
**Files**: `LeadDetailDrawer.tsx` 1,116, `ChatIntakeModal.tsx` 1,028, `dashboard/map/page.tsx` 828
**Severity**: Low
**Why it matters**: Both `LeadDetailDrawer` and `ChatIntakeModal` are dynamically loaded in their callers (drawer is opened on click, modal is intake step 2+) so bundle impact is deferred. Still — at 1,000+ LOC each, dev-cycle hot-reload becomes sluggish.
**Recommended fix**: Per [01-architecture.md F2](./01-architecture.md), extract `generateProposal()` and contractor/business section.

## Diff vs 2026-04-26

### Closed
- D3 (per-source telemetry) — was open prior
- B7 (re-enrich `assign()` helper) — was open prior

### Still open
- F4 (deadline enforcement on score + permits crons)
- F5 (useLeads partial-result swap to logger.warn)
- Bundle bloat from large components (already covered in 01-architecture.md)
