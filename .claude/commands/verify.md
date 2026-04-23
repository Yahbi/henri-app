---
description: Run the full launch-readiness gate — typecheck, build, smoke-test the changed surfaces.
---

Before saying "done" on any Phase 0a/0b/A–E slice, run this gate.

## 1. Static checks
- `pnpm tsc --noEmit` — typecheck must be clean
- `pnpm lint` if an ESLint config is present
- Fail fast: if either errors, fix before continuing

## 2. Build
- `pnpm build` — production build must compile
- Skip if only a docs or migration file changed

## 3. Smoke-test in preview
- Ensure `mcp__Claude_Preview__preview_start` server `next-dev` is running
- Navigate to each surface touched in the last commit(s):
  - `/` (marketing home)
  - `/contractors` (stats, pricing CTA)
  - `/pricing` (all 4 tiers match CLAUDE.md)
  - `/dashboard` (Leads panel hydrates; score breakdown + capacity pill + exclusivity badge visible)
  - `/dashboard/pipeline` (Kanban drag works; won cards open Job detail)
  - `/dashboard/estimate` (draft → send → status)
  - `/settings/capacity` (form saves without 500)
  - `/settings/interviews` (validation log renders)
  - `/settings/billing` (no-lock-in footer)
- Screenshot the surfaces that changed
- `mcp__Claude_Preview__preview_logs` — grep for "error", "500", "canceling statement", "does not exist" since the last compile
- `mcp__Claude_Preview__preview_console_logs` level=error — zero entries expected

## 4. Data integrity
- `npx tsx scripts/audit-desktop-sync.ts` — permit_sources / permits / zip_reference counts intact
- `curl -s -b /tmp/c.txt http://localhost:3000/api/leads?limit=10 | node -e "..."` — lead fetch returns ≥1 row for the dev user

## 5. Truthfulness regression scan
- `grep -REn "\\b(18\\.4x|26% avg|\\$8,?300|4,200\\+|94% contact|4\\.9/5)\\b" src/app src/components` — should return zero hits in rendered code (comments are fine)
- If hits: fail the gate until they're replaced with honest copy

## 6. Out-of-scope flags
- Look at what changed in `git diff` — if any non-scope file was modified (middleware, globals.css, vercel.json), call it out in the final report
- Use `mcp__ccd_session__spawn_task` to queue follow-ups that surfaced but weren't in scope

## Report format
Output a 6-line checklist with ✓/✗ per step. If every step passes, print the magic string `VERIFY_OK` so callers (CI, humans) can grep for it.
