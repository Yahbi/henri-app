---
description: Re-run the senior-engineer audit. 12 dimensions, scoreboard, top-10 priorities, single rolled-up report + per-domain files.
---

You are about to run a comprehensive Henri audit. The output goes to `docs/audits/YYYY-MM-DD/` (today's date) plus a rolled-up `docs/audits/henri-audit-YYYY-MM-DD.md`.

The most recent prior audit is `docs/audits/henri-audit-2026-04-26.md`. Read it first to understand the structure + reuse the format.

## Method

### Phase 1 — Baseline + cross-cutting greps

Capture ground truth so any "current" claim is dated:
```bash
pnpm tsc --noEmit                          # typecheck
pnpm lint --max-warnings=0                 # eslint
pnpm test                                  # vitest
pnpm truthfulness                          # CLAUDE.md contract
git status --short                         # working-tree state
```

Cross-cutting Greps for trend signals:
- TODO / FIXME / HACK / XXX count
- `as unknown as` count + clusters
- `console.log/warn/error/info` raw uses (vs structured `logger.*`)
- `Record<string, unknown>` count

### Phase 2 — Three parallel Explore agents

Launch all three in a single message (parallel) covering:

1. **Architecture + data layer**: project structure (route count, component LOC, lib subdirectories, hooks count), 44+ migrations review, RLS pattern compliance, query patterns in hooks, type discipline, hook discipline, large-component breakdown.
2. **Security + API + auth**: middleware role gating, 98 API routes auth-gate audit, service-role isolation, env handling, input validation gaps (`/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role`), LLM prompt-injection surface, Stripe webhook idempotency, dev-route allowlist.
3. **Performance + reliability + tests + observability**: test coverage by module, error-boundary coverage, graceful-degrade patterns (`/api/feedback`, `/api/exclusivity`, `useLeads` retry-fallback), cron deadline enforcement, bundle bloat, structured logger usage, Sentry sink wiring status, migration backlog.

Each agent returns a structured markdown report tagged HEALTHY / WATCH / ISSUE per finding.

### Phase 3 — Targeted reads

Read the canonical anchor files yourself (not via agent):
- `CLAUDE.md` (truthfulness contract + wedge bullets)
- `src/middleware.ts` + `src/proxy.ts`
- `src/lib/env.ts`
- `src/lib/logger.ts`
- `src/lib/auth/requireContractor.ts`
- `vercel.json`
- `package.json`
- `next.config.ts` (already has security headers)
- `.github/workflows/ci.yml`

### Phase 4 — Write 12 per-domain files + summary + rolled-up

Produce in `docs/audits/YYYY-MM-DD/`:

1. `00-summary.md` — executive scorecard, top-10 priorities (impact × effort), what blocks launch
2. `01-architecture.md` — structure + LOC + layering
3. `02-data-layer.md` — migrations + RLS + query patterns + pending backlog
4. `03-types-and-hooks.md` — `Record<string,unknown>`, `as unknown as`, hooks compliance
5. `04-api-surface.md` — 98 routes, auth gates, validation gaps
6. `05-security.md` — service-role, env, input validation, LLM, Stripe, headers
7. `06-performance.md` — query patterns, pagination, bundle, n+1, rate limits
8. `07-reliability.md` — error boundaries, graceful-degrade, idempotency
9. `08-observability.md` — logger, error sinks, Sentry, cron telemetry
10. `09-tests.md` — coverage, untested-but-critical, recommended new surfaces
11. `10-brand-and-wedge.md` — CLAUDE.md compliance: brand + truthfulness + 6 wedge bullets
12. `11-build-and-deploy.md` — vercel.json, package.json, CI, env matrix
13. `12-documentation.md` — CLAUDE.md, AGENTS.md, READMEs, comment density

Each finding ships with: severity (Critical/High/Medium/Low/Nitpick), file path + line number, "why it matters" (1 sentence tied to a CLAUDE.md rule or wedge bullet), recommended fix.

Build the rolled-up file by concatenating all 13 with a TOC + section anchors. Use a `cat` command in Bash to assemble.

### Phase 5 — Verification

After writing:
- Re-run `pnpm truthfulness` on the audit prose itself (the new files in `docs/audits/`).
- Confirm every Critical and High finding has a file path + line number.
- Confirm the rolled-up file's TOC links resolve (anchors match).

## Final deliverable

Single chat-inline message with:
1. Executive scorecard (12 rows)
2. Top-10 priorities ordered by impact × effort
3. Links to all 13 new markdown files
4. Truthfulness scan result (PASS expected on the audit's own prose)
5. Diff against the prior audit (what improved, what regressed)

## Cadence

Re-run quarterly. New audit goes to `docs/audits/YYYY-MM-DD/`. Diff against the previous to track progress.
