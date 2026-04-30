# 12 — Documentation

## TL;DR

Documentation is in good shape. `CLAUDE.md` (~187 lines) is the canonical rules contract; updated yesterday with `APOLLO_API_KEY` row in the enrichment-source env table. Root `README.md` exists. `docs/audits/` covers the 04-26 baseline (12 files + summary), the 04-26 delta, today's data-integration plan, and now today's 04-27 audit (12 files + this summary). Remaining gaps: untracked READMEs at `src/lib/README.md`, `src/components/ui/README.md`, `src/lib/enrichment/README.md`.

## Score

**HEALTHY** — root + audit docs solid; library-level READMEs need committing.

## Findings

### F1 — Root `README.md` exists (was MISSING at baseline)

- **Severity**: HEALTHY
- **File**: `README.md`
- **Status**: Onboarding guide present.

### F2 — `CLAUDE.md` canonical and up-to-date

- **Severity**: HEALTHY
- **File**: `CLAUDE.md` (~187 lines)
- **Status**: Brand, pricing, wedge, code patterns, migrations, MCP servers all documented. Yesterday added enrichment-source env-var table (WeatherStack / Numverify / Cloudmersive / Apollo); today should add `import-permit-archive.ts` script note.

### F3 — `AGENTS.md` minimal

- **Severity**: LOW
- **File**: `AGENTS.md` (1 line — Next.js 16 caveat)
- **Recommendation**: Expand for new caveats as they emerge.

### F4 — `src/lib/README.md` untracked

- **Severity**: MEDIUM
- **Why**: 28 subdirectories under `src/lib/` need a legend for new contributors.
- **Recommendation**: One-line-per-subdir summary; commit.

### F5 — `src/components/ui/README.md` untracked

- **Severity**: LOW
- **Why**: 11 UI primitives need usage docs.

### F6 — `src/lib/enrichment/README.md` untracked

- **Severity**: MEDIUM
- **Why**: Phase ordering, source precedence, cache TTLs are non-obvious.

### F7 — `docs/` inventory: comprehensive

- **Severity**: HEALTHY
- **Today** (post-04-27 audit):
  - `docs/audits/2026-04-26/` (12 files + summary)
  - `docs/audits/2026-04-26-delta.md`
  - `docs/audits/2026-04-26-product-roadmap.md`
  - `docs/audits/2026-04-27/` (12 files + this summary — NEW)
  - `docs/data-integration-plan.md` (NEW yesterday)
  - `docs/permit-coverage.md`
  - `docs/RLS.md`
  - battlecards/, sprint-plans/

### F8 — Audit history pattern (positive)

- **Severity**: HEALTHY
- **Status**: Quarterly full audits + delta audits between them. Today's full audit re-establishes the baseline; next quarterly is 2026-07-27.

### F9 — `docs/data-integration-plan.md` (NEW yesterday)

- **Severity**: HEALTHY
- **Status**: Plan for integrating the three external data folders (`Data for Onsite`, `Data Henri 3`, `henry-2.1-extracted`). Today's import-archive script is the first step of that plan.

### F10 — Battlecards + sprint-plans organized

- **Severity**: HEALTHY

### F11 — `scripts/_archive/README.md` untracked

- **Severity**: LOW
- **Recommendation**: Document why scripts archived, when they might be reused.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F2 | Update CLAUDE.md with import-permit-archive note | 10 min | No |
| F4 | Author + commit `src/lib/README.md` | 1 h | No |
| F5 | Author + commit `src/components/ui/README.md` | 1 h | No |
| F6 | Author + commit `src/lib/enrichment/README.md` | 1 h | No |
| F11 | Author `scripts/_archive/README.md` | 30 min | No |
