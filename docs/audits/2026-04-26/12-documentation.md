# 12 — Documentation

## TL;DR

`CLAUDE.md` is exceptional — it's the canonical contract for brand, pricing, wedge, code patterns, migration discipline, and verification gate. `AGENTS.md` is one-line but useful (Next.js 16 caveat). The pressing gaps: **no `README.md` at the repo root** (the standard onboarding entrypoint), **no `src/lib/README.md`** to legend the 28 lib subdirectories, **no `docs/architecture.md`** for the high-level diagram, and **no per-cron `*.md`** explaining what each scheduled job does at a glance.

## Score

**WATCH** — `CLAUDE.md` is great, but the README-shaped vacuum makes onboarding hard.

## Inventory

| File | Status | Coverage |
|---|---|---|
| `CLAUDE.md` | Excellent | Brand, pricing, policies, truthfulness, architecture, wedge, delivery patterns, code patterns, migrations, verification, files-not-to-touch |
| `AGENTS.md` | Minimal | Next.js 16 caveat — "this is NOT the Next.js you know" |
| `README.md` | **Missing** | The onboarding entrypoint — what is Henri, how do I run it locally, where do I look first |
| `docs/permit-coverage.md` | Present | Existed before this session |
| `docs/RLS.md` | Present | RLS reference |
| `docs/permit-catalog/` | Present | Per-source data permit catalog |
| `docs/battlecards/henri-battlecard-2026-04-24.html` | Present | Sales artifact |
| `docs/audits/2026-04-26/` | This audit | |
| `src/lib/README.md` | Untracked | Per `git status` — exists but uncommitted |
| `src/components/ui/README.md` | Untracked | Per `git status` — exists but uncommitted |
| `src/lib/enrichment/README.md` | Untracked | Per `git status` — exists but uncommitted |
| `scripts/_archive/README.md` | Untracked | Per `git status` — exists but uncommitted |

## Findings

### F1 — No `README.md` at repo root

- **Severity**: Medium
- **File**: `README.md` does not exist
- **Why it matters**: This is the universal "what is this repo" file. New collaborators (future hires, contractors, even AI agents on a fresh clone) look there first. Without it, onboarding requires reading `CLAUDE.md` (which is rule-dense and assumes context) and `AGENTS.md` (one line). The user knows what Henri is; nobody else does.
- **Recommendation**: Add `README.md` with the standard sections:
  ```
  # Henri.
  Permit-driven contractor lead-gen SaaS. Beta — Founder tier capped at 100.

  ## Stack
  Next.js 16 (Turbopack dev / webpack build), Supabase (Postgres + RLS),
  Stripe, Twilio, Resend, OpenAI, Mapbox, MapLibre. Tailwind v4.

  ## Local development
  pnpm install
  cp .env.local.example .env.local  # fill in keys
  pnpm dev

  ## Key files
  - CLAUDE.md — brand + wedge + code rules. Read before changing anything.
  - AGENTS.md — Next.js 16 breaking-changes warning.
  - src/middleware.ts + src/proxy.ts — auth + role gating.
  - src/lib/scoring/ — 6-signal lead scorer.
  - src/lib/enrichment/orchestrator.ts — 13-source enrichment pipeline.
  - supabase/migrations/ — additive-only, idempotent.

  ## Deploy
  Vercel-native. CRON jobs in vercel.json. Migrations applied via
  `pnpm migrate` or pasting `supabase/_pending-bundle.sql` into the
  Supabase SQL editor.

  ## Verification
  pnpm tsc --noEmit
  pnpm lint
  pnpm test
  ```
  Total ~50 lines. One hour of work. Massive onboarding payoff.

### F2 — `src/lib/README.md` is untracked

- **Severity**: Medium
- **File**: per `git status`: `?? src/lib/README.md`
- **Why it matters**: 28 subdirectories under `src/lib/` need a legend. The README exists but isn't committed.
- **Recommendation**: Commit it. If contents are sparse, expand to one line per top-level subdirectory:
  ```
  src/lib/auth/        — requireContractor, role gating, god-mode allowlist
  src/lib/scoring/     — 6-signal lead scorer (deterministic, no LLM)
  src/lib/exclusivity/ — wedge bullet #1: lock acquire/release/summarize
  src/lib/enrichment/  — 13-source orchestrator + per-source modules
  src/lib/capacity/    — wedge bullet #3: contractor envelope filter
  ...
  ```

### F3 — `src/components/ui/README.md` is untracked

- **Severity**: Low
- **File**: per `git status`: `?? src/components/ui/README.md`
- **Why it matters**: Same pattern. 11 primitives need a usage legend ("Button has size sm/md/lg/icon; Input is h-11 (44px WCAG) since 2026-04-25; Badge supports 10 variants...").
- **Recommendation**: Commit. Reference [03-types-and-hooks.md](./03-types-and-hooks.md) for the design-system audit's findings on each primitive.

### F4 — `src/lib/enrichment/README.md` is untracked

- **Severity**: Medium
- **File**: per `git status`: `?? src/lib/enrichment/README.md`
- **Why it matters**: Per session notes, this README was updated for the 13-source orchestrator. It explains the phase ordering, source precedence, and rate-limit budget. Very valuable — committing it preserves the institutional knowledge.
- **Recommendation**: Commit.

### F5 — `scripts/_archive/README.md` is untracked

- **Severity**: Low
- **File**: per `git status`: `?? scripts/_archive/README.md`
- **Why it matters**: See [11-build-and-deploy.md F14](./11-build-and-deploy.md). Without this README, the archived scripts become dead-code mystery in 6 months.
- **Recommendation**: Commit.

### F6 — `CLAUDE.md` is the canonical contract

- **Severity**: Nitpick (positive)
- **File**: `CLAUDE.md`
- **Why it matters**: This file packs an extraordinary amount of decision-context per line. Brand rules, pricing source-of-truth, the 6-bullet wedge contract, delivery patterns (feature-flag-before-migration, additive-only migrations, hooks discipline, ref-cancelled I/O effects), code patterns (Supabase client matrix, lead types, dashboard tabs, scoring), migration apply-paths, verification gate, files-not-to-touch list, plan-file references. This audit relies on it heavily — every "why it matters" sentence traces back to a CLAUDE.md rule.
- **Recommendation**: None. Continue updating it as new patterns ship. When a wedge bullet changes, the change goes here first.

### F7 — `AGENTS.md` is one-line — fine for now, expand later

- **Severity**: Low
- **File**: `AGENTS.md`
- **Why it matters**: Currently one bullet: "This is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing code." Useful warning. As more "non-obvious" patterns accumulate (Tailwind v4 CSS-first config, Supabase 1000-row cap, vitest jsdom config, Sentry instrumentation hooks), they belong here so future agents have a fast reference.
- **Recommendation**: When a new "this isn't what you'd expect" surfaces, add it to AGENTS.md. Don't split it across many small docs.

### F8 — No `docs/architecture.md` with a high-level diagram

- **Severity**: Medium
- **File**: `docs/architecture.md` does not exist
- **Why it matters**: A picture of the data flow (homeowner → /portal → /api/intake → leads table → cron/score → cron/enrich → cron/permits → contractor dashboard → /api/messages/send → Twilio) would compress hours of reading into minutes. Same for the request gating flow (browser → middleware → role check → API → requireContractor → service-role client → Supabase RLS). Onboarding investment.
- **Recommendation**: Add a Mermaid diagram in `docs/architecture.md`. ~30 lines of mermaid syntax. Keep it freshly correct; if it drifts, the doc is worse than no doc.

### F9 — No per-cron `.md` explaining what each does

- **Severity**: Low
- **File**: 15 cron routes, no documentation index
- **Why it matters**: `vercel.json` lists the schedule. The route's source code shows the implementation. Nothing summarizes "score: re-runs the 6-signal scorer for stale leads every 2h, batches 200 leads per run, deadline 280s buffer". When debugging "why didn't this lead get scored?", a reader has to open the source.
- **Recommendation**: Add `docs/cron.md` with a row per cron: name, schedule, purpose, side effects, env-var dependencies, typical p99 duration. Updated when a cron changes. ~50 lines.

### F10 — Truthfulness contract is well-documented but the scan is manual

- **Severity**: Medium (cross-references [10-brand-and-wedge.md F5](./10-brand-and-wedge.md))
- **File**: `CLAUDE.md` "Truthfulness" section
- **Why it matters**: The contract is clear: no invented metrics, no fabricated ROI, historical fakes only as code comments. Compliance is verified manually (per the battlecard work). Without an automated scan, future PRs could regress.
- **Recommendation**: Implement [10-brand-and-wedge.md F5](./10-brand-and-wedge.md)'s `scripts/truthfulness-scan.ts`. Wire into CI.

### F11 — `~/.claude/plans/` files are user-local, not in repo

- **Severity**: Nitpick (informational)
- **File**: `~/.claude/plans/composed-questing-lighthouse.md` (this audit's plan), prior plan files
- **Why it matters**: The `CLAUDE.md` "Plan files" section references `~/.claude/plans/distributed-growing-quiche.md` (the trade-native FSM + wedge plan) as the active plan. These are user-local, not committed. New contributors won't find them.
- **Recommendation**: Either (a) copy the active plan into `docs/plans/` and version-control it, or (b) document in CLAUDE.md that plan files are user-local and how to obtain the latest version. Today the reference is dangling.

### F12 — Comment density is good, especially in critical-path files

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts`, `src/lib/exclusivity/locks.ts`, `src/middleware.ts`, `supabase/migrations/*.sql`
- **Why it matters**: Spot-checks show comments explaining WHY (e.g., "stable tiebreaker on id prevents React duplicate-key warnings", "the territory step can flip onboarding_completed and the user lands on a paid dashboard without ever paying"), not just WHAT. Migrations have apply-path notes. Useful future-you context.
- **Recommendation**: None. Maintain the standard.

### F13 — `docs/RLS.md` exists; verify it's current

- **Severity**: Low
- **File**: `docs/RLS.md`
- **Why it matters**: Pre-existing RLS reference. This audit didn't open it. RLS policies are wedge-critical (a misconfigured policy = data leak). The doc must match what's actually in the live DB.
- **Recommendation**: Read end-to-end. Cross-check against the active migrations. Update if drifted.

### F14 — Inline migration apply-path notes

- **Severity**: Nitpick (positive)
- **File**: `supabase/migrations/00043_*.sql`, `00044_*.sql`, etc.
- **Why it matters**: Recent migrations end with an `-- Apply path` comment block giving the `pnpm migrate` command and the manual SQL-editor URL. Good "future-you" context.
- **Recommendation**: Maintain the standard for every new migration.

### F15 — `docs/audits/2026-04-26/` is this audit

- **Severity**: Nitpick (positive)
- **File**: This directory
- **Why it matters**: The audit IS documentation. Future re-audits compare against it. Findings turn into PRs that reference this audit by anchor (`#F1`).
- **Recommendation**: Run the audit again every quarter. Diff against the prior to see what improved.

## What's working well

- **`CLAUDE.md` is exceptional** — it's the project's contract.
- **Migration apply-paths documented inline** in every recent migration.
- **Comment density** explains WHY in critical files (useLeads, middleware, locks).
- **Plan-mode workflow** used consistently — every major change goes through a plan file.
- **`docs/permit-catalog/`** documents the data sources (a hard-won institutional artifact).
- **`docs/RLS.md`** exists (verify currency).
- **The audit's own structure** (12 per-domain files + summary + rolled-up) is itself documentation infrastructure that survives future audits.
