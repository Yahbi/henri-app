---
name: audit
description: Re-run the senior-engineer audit. 12 dimensions, scoreboard, top-10 priorities, single rolled-up report + per-domain files.
---

# Henri senior-engineer audit

Re-runs the audit baseline established at `docs/audits/2026-04-26/`. Output goes to `docs/audits/YYYY-MM-DD/` (today's date) plus a rolled-up `docs/audits/henri-audit-YYYY-MM-DD.md`.

## Method

### Phase 1 — Baseline + cross-cutting greps

```bash
pnpm tsc --noEmit
pnpm lint --max-warnings=0
pnpm test
pnpm truthfulness
git status --short
```

Cross-cutting checks: `TODO/FIXME/HACK` count, `as unknown as` count, raw `console.*` count, `Record<string, unknown>` count.

### Phase 2 — 3 parallel Explore agents

Launch in a single message:

1. **Architecture + data layer**: project structure, 44+ migrations review, RLS pattern compliance, query patterns, type discipline, hook compliance, large-component breakdown
2. **Security + API + auth**: middleware role gating, 98 API routes auth audit, service-role isolation, env handling, input validation gaps, LLM prompt-injection surface, Stripe webhook idempotency, dev-route allowlist
3. **Performance + reliability + tests + observability**: test coverage, error-boundary coverage, graceful-degrade patterns, cron deadline enforcement, bundle bloat, structured logger usage, Sentry sink wiring, migration backlog

Each agent returns a structured markdown report tagged HEALTHY / WATCH / ISSUE per finding.

### Phase 3 — Targeted reads

Self-read these high-signal anchor files (don't delegate):

- `CLAUDE.md`
- `src/middleware.ts` + `src/proxy.ts`
- `src/lib/env.ts`
- `src/lib/logger.ts`
- `src/lib/auth/requireContractor.ts`
- `vercel.json` + `package.json` + `next.config.ts`
- `.github/workflows/ci.yml`

### Phase 4 — Write 12 per-domain files + summary + rolled-up

Output structure:

```
docs/audits/YYYY-MM-DD/
  00-summary.md
  01-architecture.md
  02-data-layer.md
  03-types-and-hooks.md
  04-api-surface.md
  05-security.md
  06-performance.md
  07-reliability.md
  08-observability.md
  09-tests.md
  10-brand-and-wedge.md
  11-build-and-deploy.md
  12-documentation.md
docs/audits/henri-audit-YYYY-MM-DD.md  (concatenation with TOC)
```

Each finding ships with: severity (Critical/High/Medium/Low/Nitpick), file path + line number, "why it matters" (1 sentence tied to a CLAUDE.md rule or wedge bullet), recommended fix.

### Phase 5 — Verification

After writing:

- `pnpm truthfulness` on the audit prose itself (no fabricated metrics in the report)
- Every Critical/High finding has a file path + line number
- TOC links resolve

## Final deliverable

Single chat-inline message with:

1. Executive scorecard (12 rows)
2. Top-10 priorities by impact × effort
3. Links to all 13 markdown files
4. Truthfulness scan result
5. Diff against the prior audit (what improved, what regressed)

## Cadence

Re-run quarterly. Diff against the previous audit to track progress.
