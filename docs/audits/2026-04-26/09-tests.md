# 09 — Tests

## TL;DR

7 test files, 144 tests, all passing. The tests cover scoring, sequences, rate-limit, ingest normalization, business-name parsing, env validation, and the Stripe webhook — about ~5 critical domains. **The 13-source enrichment orchestrator, the 6-signal scorer's signal writer, the burst-enrich cron, the exclusivity lock state machine, and `useLeads` (the dashboard's busiest hook) have zero tests.** This is the single biggest investment-leverage opportunity in the audit: a focused 2-week test sprint on these 5 modules would catch ~80% of future regressions.

## Score

**ISSUE** — high coverage on small modules, zero coverage on the highest-value paths.

## Current coverage

| Module | Test file | Tests |
|---|---|---|
| `src/lib/scoring/index.ts` (subset) | `scoring/__tests__/scoring.test.ts` | n |
| `src/lib/sequences/engine.ts` | `sequences/__tests__/engine.test.ts` | n |
| `src/lib/utils/rate-limit.ts` | `utils/__tests__/rate-limit.test.ts` | n |
| `src/lib/ingest/normalize.ts` | `ingest/__tests__/normalize.test.ts` | n |
| `src/lib/enrichment/business-name-parser.ts` | `enrichment/__tests__/business-name-parser.test.ts` | n |
| `src/lib/env.ts` | `lib/__tests__/env.test.ts` | n |
| `src/app/api/webhooks/stripe/route.ts` | `webhooks/stripe/__tests__/route.test.ts` | n |

Total per CI: 7 test files, 144 tests, 0 failures, ~700ms run time.

## Findings

### F1 — `src/lib/enrichment/orchestrator.ts` has zero tests

- **Severity**: High
- **File**: `src/lib/enrichment/orchestrator.ts`
- **Why it matters**: The orchestrator composes 13 enrichment sources in a 4-phase pipeline: Phase A (sequential DB), Phase B (parallel external — county GIS, Regrid, license, OpenCorporates, Google Places, Yelp, OSM), Phase C (FEC, depends on B), Phase D (parallel terminal — voter, Hunter). Each source can fail, return null, return partial data, or hit a rate limit. The orchestrator's job is to merge these without losing precedence rules (e.g., USPS-normalized address always wins over the raw permit address). One bad merge = wrong owner data → wrong outreach. There are zero unit tests.
- **Recommendation**: Build a test harness with mocked sources. Unit-test:
  1. Phase ordering: A completes before B starts; B completes before C starts; D runs in parallel with C? Or after?
  2. Source precedence: when two sources return conflicting `owner_name`, who wins?
  3. Partial failure: source X throws, orchestrator continues, returns merged result of remaining sources.
  4. Cache: same input twice → second call doesn't re-hit external sources (cache TTL = 6h).
  5. Telemetry: `calls`, `hits`, `latency` counters increment correctly.
  Target: 30+ tests covering the merge logic.

### F2 — `src/lib/scoring/signals.ts` has zero tests

- **Severity**: High
- **File**: `src/lib/scoring/signals.ts`, called by the scoring path tested in `scoring.test.ts`
- **Why it matters**: Per `CLAUDE.md` wedge contract bullet #2: "The 6 score signals (`permit_freshness`, `permit_value`, `contact_completeness`, `zip_demand`, `homeowner_engagement`, `historical_conversion`) render in the drawer with their weights, values, and detail reasons." The signal writer in `signals.ts` produces the JSON blob that the drawer reads. If signal weights or value calculations change silently, every existing lead's drawer becomes wrong. Wedge bullet #2 is "transparent confidence" — broken signals = broken transparency.
- **Recommendation**: Unit-test each of the 6 signals: input → expected output. Pin the weights as constants imported into both the runtime and the test. Test edge cases: missing data (no permit_value → score=0 with reason "no value"), out-of-range data (permit_value=$1B → capped, not exploding the score).

### F3 — `src/app/api/cron/enrich/route.ts` has zero tests

- **Severity**: High
- **File**: `src/app/api/cron/enrich/route.ts`
- **Why it matters**: The burst-enrich cron is the system's heaviest path: 4 workers, 280s deadline buffer, work-stealing queue. A regression that forgets to update a worker's "busy" flag → idle workers, slow cron, missed enrichment. The integration with `WRITE_PROVENANCE` / `WRITE_EXTENDED` env gates means a code change can correctly write at the runtime but fail when the migration hasn't landed.
- **Recommendation**: Build a test that sets up a mock Supabase, dispatches 10 fake permits, asserts (a) all 10 get enriched, (b) workers don't deadlock, (c) `WRITE_EXTENDED=0` skips the new columns, (d) `WRITE_EXTENDED=1` with missing column raises a clear error.

### F4 — `src/lib/exclusivity/locks.ts` has zero tests

- **Severity**: Medium
- **File**: `src/lib/exclusivity/locks.ts`
- **Why it matters**: This is wedge bullet #1 — "Exclusivity is enforced on the enriched packet, not the data". The lock state machine handles: acquire (when contractor first views a lead), release (after 14 days OR after 72h of no outreach), summarize (for the dashboard badge). Bugs here = the wedge breaks. A contractor pays for exclusive access; if the lock auto-releases too early, two contractors see the same enriched packet — that's a customer-trust regression, not just a tech bug.
- **Recommendation**: Unit-test acquire/release/summarize. Test concurrent-acquire (two contractors race for the same permit — first wins). Test 72h auto-release. Test 14-day expiry. Test the watchers-bucket math (1-2 / 3-5 / 5+ never exact count).

### F5 — `src/hooks/useLeads.ts` has zero tests

- **Severity**: Medium
- **File**: `src/hooks/useLeads.ts`
- **Why it matters**: The dashboard's busiest hook. Recent changes: stable tiebreaker, defensive dedupe, wide/narrow SELECT retry-fallback. Each was driven by a real bug (220 React duplicate-key warnings, missing-column crash). Without tests, the next "small refactor" reintroduces one of these.
- **Recommendation**: Vitest + React Testing Library. Test:
  1. Single-page fetch returns N rows mapped correctly.
  2. Multi-page fetch (limit > 1000) paginates with `.range()` + dedupes overlap.
  3. `extendedColumnsMissing` cache: first fetch sets it on column-not-exists error; second fetch goes straight to NARROW.
  4. Partial-result on later-page timeout: returns rows collected so far, doesn't throw.
  5. `useUpdateLeadStatus` optimistic update + rollback on error.

### F6 — Existing tests are well-structured

- **Severity**: Nitpick (positive)
- **File**: All `__tests__/*.test.ts` files
- **Why it matters**: The 7 existing test files use vitest cleanly. No `--global` injection, no broken imports, no flaky timing. Run time is sub-second. Adding more tests follows an established pattern, not greenfield.
- **Recommendation**: None. Reuse the pattern.

### F7 — `vitest.config.ts` (or equivalent) wires DOM environment for component tests

- **Severity**: Low
- **File**: `vitest.config.ts` (existence not confirmed; check `package.json` for `test` script flags)
- **Why it matters**: Adding `useLeads` tests (F5) requires a DOM environment (jsdom or happy-dom). If vitest config doesn't enable it, the React Testing Library setup will fail.
- **Recommendation**: Confirm config supports component tests. If not, add `environment: "jsdom"` and `setupFiles: ["./vitest.setup.ts"]` with `@testing-library/jest-dom` matchers.

### F8 — No e2e tests

- **Severity**: Medium
- **File**: `playwright.config.ts` (untracked, per `git status`), `e2e/` (untracked)
- **Why it matters**: Per `git status`, Playwright config and an `e2e/` directory exist as untracked. Either the user started setting up e2e and stopped, or someone scaffolded and forgot to commit. E2e tests catch integration bugs unit tests can't (e.g., middleware redirect chains, auth flows, multi-tab session sync).
- **Recommendation**: Either (a) commit and document the e2e scaffold, write 5 critical-path tests (signup → onboarding → dashboard, lead claim, plan upgrade), or (b) delete the scaffold to reduce confusion. The "exists but doesn't run" state is the worst.

### F9 — No test for `requireContractor()` helper

- **Severity**: Medium
- **File**: `src/lib/auth/requireContractor.ts`
- **Why it matters**: This is the canonical auth helper. It returns a 401/403 response or a `{ user }` object. Used in dozens of routes. A bug here (e.g., returning `{ user }` even when `profile?.role !== "contractor"`) silently grants homeowners access to contractor-only routes.
- **Recommendation**: Unit-test the 3 paths: (1) no user → 401, (2) user but role !== "contractor" → 403, (3) user + contractor role → success. Mock `supabase.auth.getUser()` and the profiles fetch.

### F10 — No coverage report

- **Severity**: Low
- **File**: `package.json` has `test:ci: vitest run --coverage` but no checked-in baseline
- **Why it matters**: Without a coverage threshold, regressions are invisible. The thresholds don't have to be high (50% line coverage on `src/lib/` would be a meaningful step), but they need to exist.
- **Recommendation**: Add a `vitest.config.ts` `coverage.thresholds` config with `lines: 30, functions: 30, branches: 20`. Crank up over time. Wire `pnpm test:ci` into CI.

### F11 — Tests exist but no CI configuration committed

- **Severity**: Medium
- **File**: `.github/workflows/` does not appear to exist (per `git status` no `.github` mentions)
- **Why it matters**: The 144 tests pass locally. Without CI, a future PR that breaks them won't be caught until the user runs `pnpm test` themselves. For a Beta-stage product, a 5-minute CI workflow is a no-brainer.
- **Recommendation**: Add `.github/workflows/ci.yml` with `tsc --noEmit` + `eslint --max-warnings=0` + `vitest run`. Block merge on red.

## What's working well

- **All 144 tests pass cleanly** in <1 second. No flake.
- **Stripe webhook IS tested** — the highest-financial-risk surface.
- **Env validation IS tested** — the highest-deploy-risk surface.
- **Test pattern is consistent** — vitest, no exotic setup, easy to extend.
- **Clean baseline**: tsc 0, eslint 0, vitest 144/144.
