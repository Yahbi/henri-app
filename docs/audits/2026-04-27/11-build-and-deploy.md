# 11 — Build & deploy

## TL;DR

CI is now committed (`.github/workflows/ci.yml` runs tsc / lint / truthfulness / vitest / build on every PR). `package.json` scripts include `migrate`, `truthfulness`, plus the standard build/dev/test set. `vercel.json` defines 17 cron schedules with sensible cadence spread. Yesterday's session hardened `instrumentation.ts` and committed it; today's session added `scripts/_session-data-audit.ts`, `scripts/import-permit-archive.ts`, `scripts/_probe-permits-*.ts` — all untracked one-offs (acceptable). Production deploy is still gated on the 11 pending migrations (see 02 F1).

## Score

**HEALTHY** — CI gated, scripts wired; deploy unblocks once migrations land.

## Findings

### F1 — CI workflow committed (MAJOR IMPROVEMENT vs. baseline)

- **Severity**: HEALTHY
- **File**: `.github/workflows/ci.yml`
- **Status**: Runs `tsc --noEmit`, `eslint --max-warnings=0`, `truthfulness`, `vitest run`, `next build`. No broken-build deploys can slip through.

### F2 — `pnpm migrate` script wired

- **Severity**: HEALTHY (was MEDIUM at baseline)
- **File**: `package.json` line 14
- **Wiring**: `npx tsx scripts/apply-pending-migrations.ts`
- **Status**: Script extends today to cover 00031 + 00045–00051 (+`exec_sql` bootstrap).

### F3 — `instrumentation.ts` tracked + hardened

- **Severity**: HEALTHY (was UNTRACKED at baseline)
- **File**: `instrumentation.ts:1-86`
- **Status**: Function-constructor wrapper for `@sentry/nextjs` import (line 56-59) eliminates spurious build warnings.

### F4 — `vercel.json` cron schedule well-tuned (17 jobs)

- **Severity**: HEALTHY
- **Cadence spread**: 5 m → daily off-peak.
- **Recommendation**: Document rationale in a sibling `vercel.cron.md` (JSON has no comments).

### F5 — `tsconfig.json` excludes e2e + playwright config

- **Severity**: LOW (correct)
- **Status**: Type-checking skips test infrastructure.

### F6 — `eslint.config.mjs` underscore-prefixed unused vars

- **Severity**: LOW (correct)
- **Status**: Standard TS convention; flat-config migration complete.

### F7 — Untracked one-off scripts (today)

- **Severity**: LOW
- **Files**: `scripts/_session-data-audit.ts`, `scripts/_probe-permits-{schema,conflict,enum}.ts`, `scripts/import-permit-archive.ts`, `scripts/.import-state.json`, `scripts/.import-log.txt`
- **Status**: Investigation/one-off. The audit script and import script could be kept; the probes and `.import-state.json` should be `.gitignore`d.
- **Recommendation**: Add `scripts/.import-*` and `scripts/_probe-*` to `.gitignore`. Decide if `_session-data-audit.ts` and `import-permit-archive.ts` are committed or marked one-off.

### F8 — `package.json` deps audit

- **Severity**: LOW
- **Recommendation**: Grep `cobe`, `pmtiles` usage; remove if unused.

### F9 — Production deploy gated on migrations (UNCHANGED)

- **Severity**: HIGH (procedural)
- **Status**: Until `_pending-bundle.sql` applies, `/api/cron/permits` insert fails on `contact_confidence` column missing — fresh permits don't ingest.
- **Recommendation**: Apply bundle (5 min); see 02 F1.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F4 | Document cron cadence | 30 min | No |
| F7 | `.gitignore` import-state + probes; commit-or-remove others | 15 min | No |
| F8 | Audit `cobe`/`pmtiles` usage | 15 min | No |
| F9 | Apply migration bundle | 5 min | Yes |
