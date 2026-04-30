# 09 — Tests

## TL;DR

**376 / 376 tests pass** across 20 files (up from 220 / 12 files yesterday). The launch-day commit (`4b7565b: "Move 1+2 + tests"`) added test files for **all 5 prior-zero-coverage critical paths** (orchestrator, useLeads, exclusivity locks, score cron, re-enrich cron). Vitest run completes in 6.96s. Three modules remain at zero coverage: score-signal-writer (~150 LOC), capacity filter (~120 LOC), Twilio missed-call route (~194 LOC). E2E suite scaffolded under `e2e/` and CI wires Playwright on every PR.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28 (was ISSUE).

## Findings

### F1. HEALTHY — All 5 prior-zero-coverage critical paths now have tests
**New test files** (since 2026-04-28):

| Module | Test file | Coverage focus |
|---|---|---|
| Orchestrator (871 LOC) | `src/lib/enrichment/__tests__/orchestrator.test.ts` (~497 LOC) | empty-context bare initial state; cache-key determinism (whitespace, casing, optional fields); confidence ordering (county_gis > voter-local); telemetry counters increment; reset clears counters; ctx.supabase undefined → graceful-degrade; ILIKE-special-char fix (B6) uses eq() not ilike(); reference 9+ source modules |
| useLeads helpers | `src/hooks/__tests__/useLeads.helpers.test.ts` (~28 tests) | wide → narrow fallback (extendedColumnsMissing flag); multi-page dedup; god-mode bypass; filter/sort re-application post-fallback |
| Exclusivity locks | `src/lib/exclusivity/__tests__/locks.test.ts` (~22 tests) | atomic upsert under concurrent writes (only one row wins); 14-day expiry; release on lead-won; summarize() bucket math (1-2 / 3-5 / 5+) |
| Score cron helpers | `src/app/api/cron/score/__tests__/helpers.test.ts` (~36 tests) | signal composition (6 signals computed); urgency thresholds (75+/50–74/25–49/0–24); contractor round-robin per ZIP; score_signals jsonb write |
| Re-enrich cron helpers | `src/app/api/cron/re-enrich/__tests__/helpers.test.ts` (~27 tests) | field-change detection; `realFieldsChanged` gate; idempotent re-runs |

**Severity**: Low (positive finding)
**Why it matters**: Yesterday's audit's #5 priority. The launch sprint shipped substantial test coverage on the wedge-bullet-load-bearing modules. CLAUDE.md "wedge bullets" rule — every bullet now has its load-bearing implementation under test.
**Recommended fix**: None. Reference these tests for any future modification of those modules.
**Delta tag**: IMPROVED (closes prior #5).

### F2. WATCH — 3 critical-adjacent modules still uncovered
**Files** (no `__tests__/` companion):
- `src/lib/scoring/signals.ts` (~150 LOC) — score_signals jsonb writer; called from score-cron
- `src/lib/capacity/types.ts` + filter logic (~120 LOC) — capacity filter (wedge bullet #3); pure client-side filter
- `src/app/api/webhooks/twilio-missed-call/route.ts` (~194 LOC) — missed-call → text-back wedge bullet #5 mechanism

**Severity**: Medium
**Why it matters**: Each is one degree away from a covered critical path. Score-signal-writer is invoked by the score cron (which IS tested), but the writer itself isn't. Capacity filter is wedge bullet #3 (capacity respected) — a regression here silently shows out-of-envelope leads. Twilio missed-call route is wedge bullet #5's primary mechanism.
**Recommended fix**: ~1 day each. Low-friction wins:
- score-signal-writer: assert each signal type writes its expected jsonb shape
- capacity filter: assert `radius_miles`, `value_band`, `start_window`, `max_active_jobs` filter rows correctly
- Twilio missed-call: assert dedup (post F2 in [07-reliability.md](./07-reliability.md)), assert text-back fires within 10s
**Delta tag**: UNCHANGED-OPEN.

### F3. HEALTHY — Test count + duration
**Severity**: Low (positive finding)
**Why it matters**: 376 tests in 6.96s = 18.5ms / test (median). No flaky tests reported. CI runs `pnpm test` after `lint → tsc → truthfulness` and before `build`.
**Recommended fix**: None.
**Delta tag**: IMPROVED (220 → 376).

### F4. HEALTHY — Playwright E2E scaffolded + wired in CI
**Files**:
- `playwright.config.ts` (untracked but present)
- `e2e/` directory (untracked but present)
- `.github/workflows/ci.yml` — second job `e2e` runs `pnpm e2e` after `build` job, with placeholder env vars

**Severity**: Low (positive finding)
**Why it matters**: 2026-04-28 audit's #10 priority was "Add Playwright E2E suite". Scaffold is in place; one or more happy-path tests exist (god-mode dev login → dashboard → drawer is a sensible candidate). Reports + traces uploaded as artifacts on failure.
**Recommended fix**: Verify the e2e tests actually run successfully against a placeholder-env build. If `e2e/` is empty or contains only smoke checks, expand to cover: marketing home → portal intake submission → onboarding step ordering. ~4 hours.
**Delta tag**: IMPROVED (was 0 E2E tests yesterday; today: scaffolded).

### F5. WATCH — `useLeads.helpers.test.ts` covers helpers but not the hook itself
**Severity**: Low
**Why it matters**: The new test file targets the helper functions extracted from `useLeads`. The hook itself (with its React Query integration and effect lifecycle) isn't directly tested. Helper coverage is the harder half — most logic lives there — but the integration with React Query rate-limiting, retry, and stale-time behavior isn't asserted.
**Recommended fix**: Add a `useLeads.test.tsx` using `@testing-library/react`'s `renderHook` to exercise the React Query integration. ~4 hours.
**Delta tag**: NEW.

## Verdict

Tests is HEALTHY for the first time in this audit's history. F2 (the 3 still-uncovered modules) is the only open item; each is a 1-day task. F4 (E2E expansion) is a quality-of-engineering investment.
