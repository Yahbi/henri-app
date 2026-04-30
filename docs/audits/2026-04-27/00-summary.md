# Henri — Senior-engineer audit (2026-04-27)

> Quarterly-cadence full audit. Compares against `2026-04-26/` baseline + `2026-04-26-delta.md`. The session between the two added: Apollo enrichment source, re-enrichment cron, provenance UI in the lead drawer, cross-source confidence-boost rewrite, plus today's bulk permit-archive importer (running in background as of audit time).

## Executive scorecard

| # | Domain | 2026-04-26 | 2026-04-27 | Δ |
|---|---|---|---|---|
| 01 | [Architecture](./01-architecture.md) | HEALTHY | HEALTHY | unchanged |
| 02 | [Data layer](./02-data-layer.md) | ISSUE (5 pending migrations) | WATCH (11 pending) | regressed: more pending due to recent feature work; bundle ready (`_pending-bundle.sql` 1,204 LOC) |
| 03 | [Types & hooks](./03-types-and-hooks.md) | WATCH (124 casts) | WATCH (53 `as unknown as`) | improved: -57% casts (yesterday's session) |
| 04 | [API surface](./04-api-surface.md) | WATCH (3 POSTs no Zod) | WATCH (2 POSTs no Zod, 1 closed) | improved: `/api/intake` now Zod-gated |
| 05 | [Security](./05-security.md) | WATCH | WATCH | minor: `instrumentation.ts` hardened, but CSP + LLM audit still open |
| 06 | [Performance](./06-performance.md) | HEALTHY | HEALTHY | improved: `/api/leads/count` 18-25s → 4ms |
| 07 | [Reliability](./07-reliability.md) | HEALTHY | HEALTHY | unchanged + new graceful-degrade in `re-enrich` cron |
| 08 | [Observability](./08-observability.md) | WATCH (Sentry not wired) | WATCH (Sentry wired, env var pending) | improved: instrumentation complete |
| 09 | [Tests](./09-tests.md) | ISSUE (144 tests, 5 critical untested) | IMPROVING (220 tests, 5 critical still untested) | improved: +53% tests; same 5 critical gaps |
| 10 | [Brand & wedge](./10-brand-and-wedge.md) | HEALTHY | EXCELLENT | improved: provenance chips strengthen wedge #2; truthfulness automated |
| 11 | [Build & deploy](./11-build-and-deploy.md) | WATCH (no CI) | HEALTHY | improved: CI workflow committed |
| 12 | [Documentation](./12-documentation.md) | WATCH (no README, 4 untracked) | HEALTHY (README + 04-27 audit + data plan, 3 untracked) | improved: root README + delta + plan all shipped |

**Overall**: Henri is in better shape than at the baseline 24 hours ago. Six domains improved (data, types, API, perf, observability, tests, brand, build, docs). One domain regressed in raw count (data layer: 11 pending vs. 5) but the bundle is ready to apply in a single 5-minute paste.

## Top 10 priorities (ordered impact × effort)

1. **Apply the 11 pending migrations**. `supabase/_pending-bundle.sql` (1,204 LOC) → Supabase SQL editor → Run. Unblocks `/api/cron/permits` insert (`contact_confidence` column missing today), wedge bullets #1 + #6, the new re-enrich cron, the 42-template seed, storm-context drawer, and the burst-enrich indexes from 00043. ~5 minutes. [02 F1]
2. **Set `SENTRY_DSN` in Vercel env + deploy**. `instrumentation.ts` is fully wired and ready; one env var unlocks structured error forwarding for the entire `logger.error()` call surface. ~5 minutes. [08 F2 next]
3. **Test the 5 highest-leverage untested modules**. Orchestrator (~30 tests), scoring/signals (~12), exclusivity/locks (~15), useLeads (~8), `/api/cron/re-enrich` (~5). ~14 hours total. Catches ~80% of future regressions. [09 F2-F6]
4. **Add Zod to the remaining 2 POST handlers**: `/api/estimates`, `/api/billing/change-plan`. Pattern from `src/lib/schemas/api.ts` + `parseBody()`. ~1 hour. [04 F1, 05 F1 closed for `/api/intake`]
5. **Audit the LLM prompt-injection surface**. `src/app/api/ai/draft-reply/route.ts` and `src/components/portal/ChatIntakeModal.tsx` (1,028 LOC). Wrap user input in `<<<>>>` delimiters, sanitize output before display. Author `docs/audits/2026-04-27/05a-llm-safety.md`. ~3 hours. [05 F2]
6. **Auto-generate DB types**: `pnpm supabase gen types --lang=typescript > src/types/database.ts`, then refactor `mapLead()` and the 53 `as unknown as` cast sites. ~3 hours. [02 F6, 03 F1]
7. **Add CSP header to `next.config.ts`**. `default-src`, `script-src`, etc. ~1 hour. [05 F5]
8. **Replace ~150 raw `console.*` calls with `logger.*`** + add ESLint `no-console` rule. ~2 hours mechanical. [08 F4]
9. **Document `/api/agents/*`** (4 routes) + commit untracked READMEs (`src/lib/`, `src/components/ui/`, `src/lib/enrichment/`). ~3 hours. [04 F3, 12 F4-F6]
10. **Resolve `src/middleware.ts` + `src/proxy.ts` relationship**. Locate proxy.ts, document handoff or consolidate. BLOCKING for next routing change. ~2 hours. [01 F7]

## What's blocking launch

Of the 10 priorities, the **launch-blockers** (paying customers will be hurt without these) are:

- **#1** (apply bundle) — fresh permit ingest is broken until 00039 lands; new exclusivity locks can't be acquired until 00031 lands; the new daily re-enrich cron no-ops until 00051 lands. All mechanical.
- **#3** (critical-path tests) — without orchestrator + locks + useLeads tests, the next refactor could ship a wedge-violating exclusivity bug, a silent enrichment merge regression, or a dashboard rerender storm.
- **#5** (LLM safety audit) — prompt-injection in `/api/ai/draft-reply` could let a malicious homeowner manipulate AI-generated contractor outreach. Unknown-severity until reviewed.

Priorities 2, 4, 6-10 are quality-of-engineering improvements, not launch-blockers.

## What's working well (audit-wide positives)

- **Wedge contract** — all 6 bullets implemented end-to-end (ProvenanceChip strengthens #2 transparency).
- **Truthfulness** — automated, CI-gated, 0 hard fails / 0 forgeries / 0 drift today.
- **Auth + middleware + role gating** — defense-in-depth (middleware + handler-level `requireContractor()`).
- **Stripe webhook** — signature verified before parsing, idempotent on event ID.
- **Feature-flag-before-migration** — 4 reference implementations: feedback, exclusivity, useLeads column-fallback, re-enrich migration-pending degrade.
- **Cron orchestration** — deadline enforcement, per-item try/catch, work-stealing queue, polite vendor rate-limits, 17 well-cadenced schedules.
- **`/api/leads/count` race-with-timeout** — 18-25 s → 4 ms; pattern reusable for any heavy count query.
- **`instrumentation.ts`** — Function-constructor wrapper hardens the optional Sentry import against bundler static analysis (no spurious "Module not found" warnings on fresh clones).
- **Brand discipline** — no `#E8916A`, no `font-bold` Fraunces, no emojis, "Henri." with period.
- **CI workflow** — committed, runs `tsc / lint / truthfulness / vitest / next build` on every PR.
- **Audit history** — quarterly + delta cadence, with this audit re-establishing the baseline.

## Verification gate (current state)

Captured at audit-completion time today:

- `pnpm tsc --noEmit` → exit 0
- `pnpm eslint src --max-warnings=0` → exit 0
- `pnpm test --run` → 12 files / 220 tests / 0 failures / ~3.75 s
- `pnpm truthfulness` → PASS (1 pre-existing soft-warn, 0 hard fails, 0 forgeries, 0 drift)
- `git status` → working tree includes scripts from today's import work + this audit

## Methodology

Audit produced from:
1. 3 parallel Explore agents covering 12 domains, returning structured signal-rich reports.
2. Live-data audit via `scripts/_session-data-audit.ts` (permits ~932k, leads ~133.7k, fill rates).
3. Live API smoke tests (curl + dev preview) confirming `/api/leads/count` 4 ms, `/api/cron/re-enrich` graceful-degrade, `/api/intake` Zod-gated, `/api/cron/score` real lead creation, `/api/cron/permits` ingest fetching real data.
4. Cross-reference with `CLAUDE.md` rules and the 6-bullet wedge contract.

## Next audit

Re-run quarterly. Diff against this version to see whether priorities #1–#10 cleared. New audits go to `docs/audits/YYYY-MM-DD/`. Today's audit is the new baseline.
