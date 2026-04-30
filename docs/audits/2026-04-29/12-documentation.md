# 12 — Documentation

## TL;DR

`CLAUDE.md` is comprehensive (mid-MB-sized) and current. `AGENTS.md` correctly flags the Next.js 16 breaking-changes warning. README is scaffolded. **8 audit folders** now accumulated under `docs/audits/` (2026-04-26, 2026-04-26-delta, 2026-04-26-product-roadmap, 2026-04-27, 2026-04-28, 2026-04-29 + 2 rolled-up files) — suggest archival policy after 30 days. Inline comment density is healthy across the lib/ + middleware code.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Findings

### F1. HEALTHY — CLAUDE.md is the source of truth
**File**: `C:\Users\yabis\Desktop\Henri App\CLAUDE.md`
**Severity**: Low (positive finding)
**Why it matters**: The brand, pricing, policy, architecture, wedge contract, delivery patterns, code patterns, migrations, MCP servers, and plugin inventory are all documented. Contractor-only API gating, RLS policies, file-not-to-touch list, and the truthfulness contract are all explicit. The Karpathy guidelines section + ECC install + Knowledge Work Plugins section + claude-code-templates inventory are all up to date.
**Recommended fix**: None. Optional: split into multiple files (`CLAUDE-brand.md`, `CLAUDE-architecture.md`, etc.) once it crosses ~5MB; currently fine.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — AGENTS.md flags Next.js 16 breaking changes
**File**: `AGENTS.md`
**Severity**: Low (positive finding)
**Why it matters**: Single-line warning that Next.js 16 has APIs / conventions / file structure that differ from training data, with a pointer to read `node_modules/next/dist/docs/` before writing code. Prevents stale-knowledge regressions.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F3. WATCH — `docs/audits/` accumulating without archival policy
**Files**:
- `docs/audits/2026-04-26/` (12 files)
- `docs/audits/2026-04-26-delta.md`
- `docs/audits/2026-04-26-product-roadmap.md`
- `docs/audits/2026-04-27/` (12 files)
- `docs/audits/2026-04-28/` (12 files) + `henri-audit-2026-04-28.md` (rolled-up)
- `docs/audits/2026-04-29/` (this audit, 14 files + rolled-up)
- `docs/audits/henri-audit-2026-04-26.md` (rolled-up)

**Severity**: Low
**Why it matters**: 8 dated folders + 2 rolled-up files in 4 days. At quarterly cadence this would be 4 folders, but the launch sprint induced daily audits. Without archival, the directory accretes.
**Recommended fix**: Add `docs/audits/_archive/` for audits older than 30 days. Move `2026-04-26/`, `2026-04-26-delta.md`, `2026-04-26-product-roadmap.md`, `2026-04-27/` there once they age out. Update CLAUDE.md's "Cadence" note. ~10 min.
**Delta tag**: REGRESSED (folder count up by 2 in 24 hours).

### F4. HEALTHY — Inline comment density healthy in critical files
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `instrumentation.ts`, `src/lib/logger.ts`, `src/lib/webhooks/idempotency.ts`, `src/middleware.ts`, `src/lib/env.ts`. Each has a top-of-file purpose docstring + inline rationale comments at non-obvious points (e.g., the dynamic-import Function-trick at `instrumentation.ts:47–55` has a 9-line comment block explaining WHY). Fields like `score_signals: unknown` in `src/types/lead.ts:29-31` carry inline rationale.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — Repo-root README minimal
**File**: `README.md`
**Severity**: Low
**Why it matters**: 2026-04-28 audit said "README scaffolded". Quick check shows it's present but lean. For a public-or-shared repo, a richer README (project description, local-dev quickstart, tech stack, contributing pointer to AGENTS.md + CLAUDE.md) would help onboarding.
**Recommended fix**: Expand to ~200 lines covering project overview, prerequisites (Node 20, pnpm 9, Supabase CLI, Vercel CLI), `git clone → pnpm install → cp .env.example .env.local → pnpm dev`, deployment pointer to `vercel.json` + `.github/workflows/ci.yml`. ~30 min.
**Delta tag**: UNCHANGED.

## Verdict

Documentation is HEALTHY. F3 (audit archival) and F5 (README expansion) are the only meaningful improvements available.
