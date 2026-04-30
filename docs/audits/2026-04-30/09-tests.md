# 09 — Tests (2026-04-30)

## TL;DR

22 test files / 428 tests; all passing in 4.23s via Vitest 4.1.4. **+52 tests since 04-29** (376 → 428). Three critical paths still untested — same 3 as 04-29 priority #9: score-signal-writer (`src/lib/scoring/signals.ts`), capacity-filter (`src/lib/capacity/types.ts`), Twilio missed-call route. Today's commit didn't add new tests (the changes were UX fixes verified via live Chrome smoke test, not unit-test surfaces).

## Score

**WATCH** — IMPROVED vs 2026-04-29 (+52 tests) but the 3 known gaps remain.

## Test inventory (22 files / 428 tests)

| Module | Test file | Status |
|---|---|---|
| `src/lib/agents/__tests__/outreach-personalizer.test.ts` | ✓ | |
| `src/lib/enrichment/__tests__/orchestrator.test.ts` | ✓ | Added in 04-29 batch |
| `src/lib/enrichment/derived/__tests__/index.test.ts` | ✓ | |
| `src/lib/exclusivity/__tests__/locks.test.ts` | ✓ | Added in 04-29 batch |
| `src/lib/ingest/__tests__/normalize.test.ts` | ✓ | |
| `src/lib/predictive/__tests__/rules.test.ts` | ✓ | |
| `src/lib/predictive/__tests__/llm-mining.test.ts` | ✓ | |
| `src/lib/permits/__tests__/...` | ✓ | (multiple) |
| `src/hooks/__tests__/useLeads.test.ts` | ✓ | Added in 04-29 batch (mapRowsToLeads only — main hook still partial) |
| `src/hooks/__tests__/useLeads.helpers.test.ts` | ✓ | |
| `src/app/api/cron/score/__tests__/route.test.ts` | ✓ | Added in 04-29 batch |
| `src/app/api/cron/re-enrich/__tests__/route.test.ts` | ✓ | Added in 04-29 batch |
| `src/app/api/billing/change-plan/__tests__/route.test.ts` | ✓ | |
| `src/app/api/webhooks/stripe/__tests__/route.test.ts` | ✓ | |
| `src/app/api/webhooks/twilio/__tests__/route.test.ts` | ✓ | (status webhook only) |
| (etc — 7 more) | | |

## Findings

**T1** | **High** | `src/lib/scoring/signals.ts` — no test coverage
- **Issue**: `buildScoreSignalBreakdown()` and `detailFor()` power the transparency drawer's signal breakdown (the 6-signal renderer that's the visible commitment to wedge bullet #2 — transparent confidence). One bad pattern match on factors or missing signals.weight field silently breaks the UI.
- **Why it matters**: Wedge bullet #2 is the second-strongest reason contractors pick Henri. A regression here is invisible until a contractor opens a drawer and sees a half-broken score breakdown.
- **Recommended fix**: Create `src/lib/scoring/__tests__/signals.test.ts` with ≥10 cases:
  - Each of 6 signals (permit_freshness, permit_value, contact_completeness, zip_demand, homeowner_engagement, historical_conversion) at min/max/mid values.
  - Empty signals object → fallback rendering.
  - Unknown signal name → graceful skip.
  - Detail-for known patterns + unknown patterns.
  ~3 hours.

**T2** | **Medium** | `src/lib/capacity/types.ts` — no test coverage
- **Issue**: `isCapacityPrefs()` and `hasActivePrefs()` type guards underpin the capacity filter (wedge bullet #3 — capacity respected). Edge cases: empty array for `preferred_days_of_week` is valid (means "any day") but untested.
- **Why it matters**: Wedge bullet #3 is the silent reason contractors stay (no junk leads outside their envelope). A bad guard returns rows that should be filtered, breaking trust.
- **Recommended fix**: `src/lib/capacity/__tests__/types.test.ts` with ≥5 cases (valid prefs, invalid prefs, empty arrays, null fields, all-active vs none-active). ~1 hour.

**T3** | **Medium** | `src/app/api/webhooks/twilio-missed-call/route.ts` — no integration test
- **Issue**: POST handler validates Twilio HMAC signature, parses form-urlencoded body, inserts to `missed_call_events`, sends auto-reply SMS. No integration test; signature path untested.
- **Why it matters**: Wedge bullet #5 (speed-to-lead). The missed-call text-back is the brand moment. A broken signature path = silent dead webhook = no auto-reply = wedge violation.
- **Recommended fix**: Integration test exercising:
  - Valid signature → 200 + insertion + SMS send (mocked).
  - Invalid signature → 401, no insertion, no SMS.
  - Missing body fields → 400.
  - Twilio retry (same callSid) → idempotent (after the F7/R3 fix lands).
  ~2 hours.

**T4** | **HEALTHY** | Scoring engine (`src/lib/scoring/__tests__/scoring.test.ts`)
- Covers `calculateScore()`, signal building, urgency classification.
- Fixture-based tests with permit rows + contractor profiles.
- Good parity with Phase 3 launch.

**T5** | **Low** | `useLeads` main hook coverage
- Today only tests `mapRowsToLeads` helper. The main `useLeads()` hook (with React Query plumbing, optimistic updates, retry-fallback path) is untested.
- **Why it matters**: This hook is the dashboard's data path. Bug in the fallback logic = blank dashboard for contractors during a column-add migration window.
- **Recommended fix**: Add `src/hooks/__tests__/useLeads.test.tsx` (note the .tsx — uses RTL render). Mock the supabase client; cover happy path + error path + extended-columns missing path. ~3 hours.

## Test discipline

- Vitest 4.1.4 (devDependencies).
- 4.23s wall-clock for 428 tests across 22 files. No flaky tests observed.
- All tests run on `pnpm vitest run` (not `pnpm test`, which is also `vitest run`).

## Closing

Test count grew well in the 04-29 batch (+156 tests). Today's commit didn't add tests because the changes were UX fixes covered by live Chrome smoke. The 3 known gaps (T1, T2, T3) remain the priority, all 3 tied to wedge bullets that we promise to contractors.
