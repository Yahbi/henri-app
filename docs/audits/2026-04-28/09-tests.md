# 09 — Tests

## TL;DR

220 / 220 tests pass across 12 files. Existing tests are well-targeted (scoring engine, rules engine, Stripe webhook, normalizer, sequences engine, business-name parser, env validation, outreach personalizer, rate-limit utils, derived enrichment). The five untested-but-critical paths from the prior audit **remain at zero coverage**: orchestrator (871 LOC), useLeads (395 LOC), exclusivity locks, score cron (733 LOC), re-enrich cron. **No E2E suite exists.**

## Score

**ISSUE** — adding tests on the 5 critical paths is the highest-leverage regression-resistance work. ~1 week sprint.

## Coverage matrix

| Module | LOC | Test file | Status |
|---|---:|---|---|
| Stripe webhook | n/a | `src/app/api/webhooks/stripe/__tests__/route.test.ts` | ✓ Covered |
| Scoring engine | ~700 | `src/lib/scoring/__tests__/scoring.test.ts` | ✓ Covered |
| LLM mining | ~300 | `src/lib/predictive/__tests__/llm-mining.test.ts` | ✓ Covered |
| Rules engine | ~500 | `src/lib/predictive/__tests__/rules.test.ts` | ✓ Covered |
| Permit applicant classifier | ~150 | `src/lib/permits/__tests__/applicant-classifier.test.ts` | ✓ Covered |
| Business-name parser | ~100 | `src/lib/enrichment/__tests__/business-name-parser.test.ts` | ✓ Covered |
| Outreach personalizer | ~200 | `src/lib/agents/__tests__/outreach-personalizer.test.ts` | ✓ Covered |
| Rate-limit utils | ~80 | `src/lib/utils/__tests__/rate-limit.test.ts` | ✓ Covered |
| Normalizer | ~250 | `src/lib/ingest/__tests__/normalize.test.ts` | ✓ Covered |
| Env validation | ~100 | `src/__tests__/env.test.ts` | ✓ Covered |
| Sequences engine | ~400 | `src/lib/sequences/__tests__/engine.test.ts` | ✓ Covered |
| Derived enrichment | ~150 | `src/lib/enrichment/derived/__tests__/index.test.ts` | ✓ Covered |
| **Enrichment orchestrator** | **871** | **— (none)** | **✗ ZERO** |
| **`useLeads` hook** | **395** | **— (none)** | **✗ ZERO** |
| **Exclusivity locks** | **~200** | **— (none)** | **✗ ZERO** |
| **Score cron** | **733** | **— (none)** | **✗ ZERO** |
| **Re-enrich cron** | **~400** | **— (none)** | **✗ ZERO** |
| Score signal writer | ~150 | — (none) | ✗ ZERO |
| Capacity filter | ~120 | — (none) | ✗ ZERO |

## Findings

### F1. ISSUE — Orchestrator (871 LOC, 9-pass enrichment) is uncovered
**File**: `src/lib/enrichment/orchestrator.ts`
**Severity**: High
**Why it matters**: Orchestrator composes 9 enrichment passes (county-GIS, voter-file, FEC, OpenCorporates, Hunter.io, Apollo, NumVerify, Cloudmersive, derived) and merges them into a single `EnrichedContact` object. A refactor that breaks the merge logic (e.g., wrong nullish coalescing operator) ships silently — every lead gets the wrong owner_name, but `tsc` still passes. CLAUDE.md "wedge bullet #2 (transparent confidence)" requires the merge logic be correct.
**Recommended fix**: Add unit tests:
- mock each vendor response → assert merged `EnrichedContact` matches expected shape
- assert highest-confidence source wins for each field
- assert telemetry counters increment correctly
- assert cache hit/miss path
~6 hours.

### F2. ISSUE — `useLeads` hook (395 LOC) is uncovered
**File**: `src/hooks/useLeads.ts`
**Severity**: High
**Why it matters**: Reference implementation of the paginated query pattern. CLAUDE.md "client-side fallback first" requires proving the migration fallback works (lines 145-179: extendedColumnsMissing flag, retry on missing-column). A refactor that breaks the flag would ship silently — leads still load, but extended fields silently drop.
**Recommended fix**: Add tests:
- wide SELECT succeeds on modern schema
- missing-column error triggers fallback to NARROW
- filters re-applied post-fallback
- multi-page dedup (the `Map<id, row>` collection at lines 242-248)
- god-mode bypass (no `contractor_id` filter)
~4 hours.

### F3. ISSUE — Exclusivity locks (~200 LOC) are uncovered — wedge bullet #1
**File**: `src/lib/exclusivity/locks.ts`
**Severity**: High
**Why it matters**: Exclusivity locks enforce wedge bullet #1 (one contractor per permit per trade for 14 days). A race condition (two `upsert` calls arriving simultaneously) could violate the exclusivity invariant. B4+B5 fix earlier this session switched to atomic `.upsert(...)` with retry — but the test that proves it under concurrency doesn't exist.
**Recommended fix**: Add tests:
- atomic upsert under concurrent inserts (assert only ONE row wins)
- lock expiry after 14 days
- lock release on lead won
- `summarize()` with `1-2`, `3-5`, `5+` buckets (wedge bullet #6 — coarse competitive intel)
~4 hours.

### F4. ISSUE — Score cron (733 LOC) is uncovered
**File**: `src/app/api/cron/score/route.ts`
**Severity**: High
**Why it matters**: Scores all leads on a 2h cadence (per `vercel.json`). A regression in signal composition or urgency calculation ships silently to all contractors. The score is the primary user-facing trust signal (wedge bullet #2).
**Recommended fix**: Add integration-style tests with mocked Supabase:
- score a sample permit → assert all 6 signal components computed
- assert urgency thresholds (75+ hot, 50-74 warm, 25-49 cool, 0-24 cold)
- assert `score_signals` jsonb written to leads
- assert contractor round-robin assignment per ZIP
~6 hours.

### F5. ISSUE — Re-enrich cron (~400 LOC) is uncovered
**File**: `src/app/api/cron/re-enrich/route.ts`
**Severity**: Medium-High
**Why it matters**: B7 fix earlier this session changed the patch builder to use `assign()` helper (true field-change detection). Without tests, a future refactor could revert this and silently re-update every previously-enriched lead nightly (the original bug).
**Recommended fix**: Add tests:
- patch only emitted when value changes
- `realFieldsChanged > 0` gate works
- non-changing rows don't bump `updated_at`
~3 hours.

### F6. WATCH — No E2E or integration tests
**Files**: `vitest.config.ts` (only "node" environment)
**Severity**: Medium
**Why it matters**: All tests are unit-level. A refactor that breaks the dashboard → leads fetch → drawer → mutation flow wouldn't be caught by unit tests. Playwright is not wired.
**Recommended fix**: Add `pnpm e2e` script running Playwright on local Supabase. Start with one happy-path test:
- god-mode dev login → dashboard loads → leads list populates → click lead → drawer opens → close → list refreshes
~4 hours setup + 1 test.

### F7. HEALTHY — Critical-path coverage on scoring + rules + Stripe
**Files**: `src/lib/scoring/__tests__/scoring.test.ts`, `src/lib/predictive/__tests__/rules.test.ts`, `src/app/api/webhooks/stripe/__tests__/route.test.ts`
**Why it matters**: These are the parts that ARE tested. Rules engine has 100+ test cases for cross-trade evaluation. Stripe webhook tests cover signature verification, idempotency on event.id, and the recent B3 reorder fix.
**Status**: Quality is high where coverage exists.

### F8. NITPICK — Test naming convention mostly consistent
**Files**: `src/**/__tests__/*.test.ts`
**Why it matters**: Most tests live in `__tests__/` co-located with source. A few outliers exist but it's not a strict rule violation.
**Status**: No action.

## Diff vs 2026-04-26

### Improved
- Test count: 144 → 220 (+53%) across same number of files (12) — existing files added more cases
- All 220 tests pass; no regressions
- Stripe webhook coverage extended to cover B3 reorder fix

### Still open
- F1-F5 (5 critical paths uncovered) — all from prior #6 priority, all still 0%
- F6 (no E2E) — newly explicit; was implicit in prior audit

### Recommended priority for next sprint
A 1-week focused sprint hitting F1-F5 (orchestrator, useLeads, locks, score cron, re-enrich) would close the largest open issue domain in the audit. Each is well-isolated and has clear inputs/outputs. ~30 hours of focused work, mostly mock-heavy.
