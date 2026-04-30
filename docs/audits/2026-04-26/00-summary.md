# Henri — Senior-engineer audit (2026-04-26)

## Executive scorecard

| # | Domain | Status | Top issue |
|---|---|---|---|
| 01 | [Architecture](./01-architecture.md) | HEALTHY | 4 components > 800 LOC; `src/middleware.ts` + `src/proxy.ts` parallel routing files need clarity |
| 02 | [Data layer](./02-data-layer.md) | ISSUE | 5 pending migrations (00040–00044) blocking burst-enrich + new enrichment writes |
| 03 | [Types & hooks](./03-types-and-hooks.md) | WATCH | 124 `Record<string,unknown>` casts + 37 `as unknown as` casts — auto-generated DB types would close most |
| 04 | [API surface](./04-api-surface.md) | WATCH | 3 POST handlers accept JSON without Zod validation; `agents/*` namespace undocumented |
| 05 | [Security](./05-security.md) | WATCH | LLM prompt-injection surface unaudited; no CSP or security headers |
| 06 | [Performance](./06-performance.md) | HEALTHY | Burst-enrich blocked on missing 00043 partial indexes; hot routes lack rate limits |
| 07 | [Reliability](./07-reliability.md) | HEALTHY | No global retry/backoff for vendor calls; webhook idempotency on Twilio/Resend not confirmed |
| 08 | [Observability](./08-observability.md) | WATCH | Sentry sink scaffolded but not wired (5-min task); 148 raw `console.*` bypass the structured logger |
| 09 | [Tests](./09-tests.md) | ISSUE | Orchestrator, signal writer, burst-enrich cron, exclusivity locks, useLeads — all zero coverage |
| 10 | [Brand & wedge](./10-brand-and-wedge.md) | HEALTHY | Truthfulness scan is manual; automate in CI |
| 11 | [Build & deploy](./11-build-and-deploy.md) | WATCH | No CI workflow committed; `pnpm migrate` documented but unwired |
| 12 | [Documentation](./12-documentation.md) | WATCH | No repo-root `README.md`; 4 README files exist untracked |

**Overall**: Henri's bones are solid. The wedge contract (6 bullets) is implemented end-to-end. Brand discipline holds. Auth + middleware + role gating are correct. Stripe is exemplary. The 3 areas below the line — pending migrations, test coverage, and observability wiring — are mechanical work that doesn't require new design decisions. The audit's recommendation is to clear those, then ship.

## Top 10 priorities (ordered impact × effort)

1. **Apply the 5 pending migrations** (00039–00044). Single 30-minute task: paste `supabase/_pending-bundle.sql` into the Supabase SQL editor. Unblocks: burst-enrich performance (00043 partial indexes), voter-file + PPP enrichment sources (00041, 00042), Contractor/Business section in lead drawer (00044). [02-data-layer.md F1](./02-data-layer.md)
2. **Wire Sentry via the existing logger sink**. 5-line `instrumentation.ts` per the doc-comment in `src/lib/logger.ts`. Every existing `logger.error()` call site instantly forwards to Sentry. ~30 minutes, including `pnpm add @sentry/nextjs`. [08-observability.md F2](./08-observability.md)
3. **Add CI workflow** (`.github/workflows/ci.yml`). Runs `tsc --noEmit`, `eslint --max-warnings=0`, `vitest run`. Blocks merge on red. ~30 minutes. [11-build-and-deploy.md F1](./11-build-and-deploy.md)
4. **Add Zod validation to 3 POST handlers**: `/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role`. ~1 hour total. Hardens the user-input edges. [04-api-surface.md F1-F3](./04-api-surface.md), [05-security.md F1](./05-security.md)
5. **Audit the LLM surfaces for prompt injection**: `/api/ai/draft-reply`, `/api/agents/*`, `ChatIntakeModal`. Manual review, document findings in `05a-llm-safety.md`. ~3 hours, but unknown-unknowns may extend. [05-security.md F2](./05-security.md)
6. **Test the 5 untested-but-critical modules**: orchestrator, signal writer, burst-enrich cron, exclusivity locks, useLeads. ~1 week of focused work. Catches ~80% of future regressions. [09-tests.md F1-F5](./09-tests.md)
7. **Auto-generate DB types** via `mcp__supabase__generate_typescript_types`. One script (`pnpm types:db`), one new file (`src/types/database.ts`). Eliminates ~80% of the 124 `Record<string,unknown>` casts and ~50% of the 37 `as unknown as` casts. ~2 hours including refactor of `mapLead`. [02-data-layer.md F6](./02-data-layer.md), [03-types-and-hooks.md F1-F2](./03-types-and-hooks.md)
8. **Add security headers** (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) via `next.config.ts` `headers()`. Optional CSP after maplibre/Vercel-analytics origins are allowlisted. ~1 hour. [05-security.md F7-F8](./05-security.md)
9. **Add `pnpm migrate` script + automated truthfulness scan**. Two small additions to `package.json` + `scripts/`. Removes the documentation lie about `pnpm migrate` and enforces the truthfulness contract in CI. ~30 minutes. [02-data-layer.md F4](./02-data-layer.md), [10-brand-and-wedge.md F5](./10-brand-and-wedge.md)
10. **Add `README.md` at repo root** + commit the 4 untracked READMEs (`src/lib/README.md`, `src/components/ui/README.md`, `src/lib/enrichment/README.md`, `scripts/_archive/README.md`). 1 hour. Removes the onboarding vacuum. [12-documentation.md F1-F5](./12-documentation.md)

## What blocks launch

Of the 10 priorities, the **launch-blockers** (paying customers will be hurt without these) are:

- **#1** (apply migrations) — burst-enrich can't run reliably without 00043's partial indexes; new enrichment columns aren't queryable until 00044 lands. Both are mechanical work, blocking only on someone clicking "Run".
- **#5** (LLM safety audit) — if a prompt-injection vulnerability exists in `/api/ai/draft-reply` or `ChatIntakeModal`, a malicious homeowner can manipulate AI-generated contractor outreach. Unknown-severity until reviewed.
- **#6** (test coverage on critical paths) — without tests, the next refactor of `useLeads`, `orchestrator`, or `locks.ts` could ship a regression that costs paying customers (e.g., a wedge-violating exclusivity bug, a silent data-loss enrichment merge). Worth a 1-week sprint.

The other 7 priorities are quality-of-engineering improvements, not launch-blockers.

## What's working well (audit-wide positives)

- **Wedge contract implemented end-to-end** — all 6 bullets ship in code, with reference implementations of the patterns they require.
- **Auth + middleware + role gating** is defense-in-depth — middleware blocks the obvious bypasses, `requireContractor()` blocks the subtle ones.
- **Service-role key isolated** to server-only modules — never reaches the browser bundle.
- **Stripe webhook is exemplary** — signature verified before parsing, idempotent on event ID, no client-controlled IDs read from request body.
- **Error boundaries** at every route segment — no Next.js grey screen on render errors.
- **Feature-flag-before-migration pattern** has 3 reference implementations (`/api/feedback`, `/api/exclusivity`, `useLeads` retry-fallback). The app graceful-degrades correctly under partial migration deploys.
- **Cron orchestrator** is fault-tolerant — deadline enforcement, per-item try/catch, work-stealing queue, polite vendor rate-limits.
- **Brand discipline** holds — no `font-bold` on Fraunces, no `#E8916A`, no emojis, "Henri." with the period. Truthfulness contract holds — fake metrics exist only as code-comment markers.
- **`useLeads` is the canonical query pattern** — paginated, deduped, fault-tolerant, retry-on-missing-column, partial-result-on-page-timeout.
- **`CLAUDE.md`** is the project's contract — every audit "why it matters" sentence traces back to a rule there.

## Verification gate (current state)

Captured at audit start, ground truth for any "current" claim in this report:

- `pnpm tsc --noEmit` → exit 0
- `pnpm eslint src --max-warnings=0` → exit 0
- `pnpm vitest run` → 7 files / 144 tests / 0 failures / ~700ms
- `git status` → 163 files modified, 221 working-tree entries (mix of `M` and `??`)

## Methodology

Audit produced from:
1. 3 parallel Explore agents (architecture / security / perf+reliability+tests) producing structured signal-rich reports.
2. Targeted reads of anchor files (`src/middleware.ts`, `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/auth/requireContractor.ts`, `vercel.json`).
3. Cross-cutting `Grep` passes (`as unknown as`, `console.*`, TODO/FIXME/HACK).
4. Live state checks (`tsc`, `eslint`, `vitest`).
5. Cross-reference with `CLAUDE.md` rules and the 6-bullet wedge contract.

No code edits. No production data sampling. Findings about live DB state are flagged "per session notes" or "estimated, not verified".

## Next audit

Re-run quarterly. Diff against this version to see whether priorities #1–#10 cleared. New audits go to `docs/audits/YYYY-MM-DD/`.
