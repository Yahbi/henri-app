# 09 — Tests

## TL;DR

**12 test files, 220 tests, all passing** in ~3.75 s — up from 7 files / 144 tests at baseline (+99 tests, +5 files, +53%). Coverage growth is concentrated in newly added enrichment + agent + classifier modules. The 5 highest-leverage untested modules remain: orchestrator, scoring/signals, exclusivity/locks, useLeads, and the new re-enrich cron. Today's session added the importer (`scripts/import-permit-archive.ts`) without tests — acceptable as one-off, but flag if it becomes recurring.

## Score

**IMPROVING** — test count up sharply, but the 5 load-bearing paths still lack coverage.

## Current coverage

| Module | Tests | Status |
|---|---|---|
| `src/lib/scoring/index.ts` | ~21 | covered |
| `src/lib/sequences/engine.ts` | ~17 | covered |
| `src/lib/utils/rate-limit.ts` | ~28 | covered |
| `src/lib/ingest/normalize.ts` | ~48 | covered |
| `src/lib/enrichment/business-name-parser.ts` | ~31 | covered |
| `src/lib/permits/applicant-classifier.ts` | ~10 | covered |
| `src/lib/agents/outreach-personalizer.ts` | ~10 | covered |
| `src/lib/enrichment/derived/index.ts` | ~16 | covered |
| `src/lib/predictive/llm-mining.ts` | ~14 | covered |
| `src/lib/predictive/rules.ts` | ~26 | covered |
| `src/lib/env.ts` | ~12 | covered |
| `src/app/api/webhooks/stripe/route.ts` | ~10 | covered |
| **Total** | **220** | **all passing** |

## Findings

### F1 — Test count +53% from baseline (positive signal)

- **Severity**: LOW (positive)
- **Status**: New tests cover the modules added in Phase 1.2-2.6 (rules, applicant classifier, outreach personalizer, derived enrichments, LLM mining).
- **Recommendation**: Keep the trajectory; F2-F6 below name the next tier.

### F2 — `src/lib/enrichment/orchestrator.ts` zero dedicated tests

- **Severity**: HIGH
- **File**: 36 KB, 4-phase pipeline composing 13+ sources
- **Why**: Source merge-precedence, partial-failure handling, cache TTL — all untested.
- **Recommendation**: Test harness with mocked sources covering: phase ordering (A→B→D parallel), source precedence, partial failure (one source throws, orchestrator continues), cache hit/miss, telemetry counters. Target 30+ tests.

### F3 — `src/lib/scoring/signals.ts` zero tests

- **Severity**: HIGH (wedge bullet #2)
- **Why**: Each of 6 signals (`permit_freshness`, `permit_value`, `contact_completeness`, `zip_demand`, `homeowner_engagement`, `historical_conversion`) writes to drawer-visible JSON. Silent weight changes would break wedge transparency.
- **Recommendation**: Unit-test each signal: input → expected `{score, weight, reason}`. Pin weights as importable constants.

### F4 — `src/lib/exclusivity/locks.ts` zero tests (wedge bullet #1)

- **Severity**: HIGH
- **Why**: Customers lose exclusive access if acquire/release/summarize regresses. Trust regression, not just tech bug.
- **Recommendation**: Unit-test acquire/release/summarize, concurrent-acquire race, 72 h auto-release, 14-day expiry, watchers-bucket math.

### F5 — `src/hooks/useLeads.ts` zero tests (dashboard-critical)

- **Severity**: HIGH
- **Recommendation**: Vitest + RTL test: single-page → multi-page → extendedColumnsMissing cache → partial-result on later-page timeout → optimistic-update + rollback.

### F6 — `src/app/api/cron/re-enrich/route.ts` zero tests (NEW 2026-04-26)

- **Severity**: HIGH
- **Recommendation**: Integration test (mock Supabase): 10-permit dispatch, all enrich, no deadlock, contact_source written when `WRITE_PROVENANCE=1`, graceful-degrade when 00051 not applied.

### F7 — `src/lib/enrichment/apollo.ts` zero tests (NEW 2026-04-26)

- **Severity**: MEDIUM
- **File**: `src/lib/enrichment/apollo.ts`
- **Why**: Contractor-only B2B principal lookup; gated on `applicant_classification === "contractor"`. Module untested.
- **Recommendation**: Mock-fetch test for happy path, 429 rate-limit trip, 404 not-found, malformed response.

### F8 — `scripts/import-permit-archive.ts` zero tests (procedural)

- **Severity**: LOW
- **Why**: One-off bulk loader; bug-fixes today (status NOT NULL, varchar(5) overflow, bigint overflow) suggest the test surface is non-trivial.
- **Recommendation**: If kept long-term, unit-test `mapRow()`, `parseDate()`, `parseNumber()`, `normalizePermitType()` (pure functions).

### F9 — Existing tests are well-structured (positive)

- **Severity**: HEALTHY
- **Status**: No global injection, no flaky timing, vitest patterns clean.

## Recommendations summary

| # | Module | Test count target | Effort |
|---|---|---|---|
| F2 | orchestrator | 30+ | 4-6 h |
| F3 | scoring/signals | 12+ | 2 h |
| F4 | exclusivity/locks | 15+ | 3 h |
| F5 | useLeads | 8+ | 3 h |
| F6 | cron/re-enrich | 5+ | 2 h |
| F7 | apollo | 6+ | 1 h |
