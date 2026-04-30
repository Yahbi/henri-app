# 11 — Build & Deploy

## TL;DR

CI workflow is live. Vercel cron schedule is comprehensive (17 entries). Build succeeds with placeholder env vars. The single open WATCH is **`pnpm migrate` flow falls back to clipboard-paste in production-like environments** because the auto-bootstrapped `exec_sql` RPC isn't installed in Supabase yet.

## Score

**HEALTHY** — closes prior #3 (CI workflow) and #9 (`pnpm migrate` script) priorities.

## CI workflow

**File**: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Setup pnpm@9 + Node@20
      - Install dependencies (frozen lockfile)
      - Lint (eslint --max-warnings=0)
      - Type check (tsc --noEmit)
      - Truthfulness scan (CLAUDE.md contract)
      - Test (vitest)
      - Build (next build with placeholder env)
```

Gates merge on red. Closes prior #3 priority.

## Vercel cron schedule

**File**: `vercel.json` (17 cron entries)

| Path | Schedule | Cadence |
|---|---|---|
| `/api/cron/score` | `0 */2 * * *` | Every 2h |
| `/api/cron/scrape` | `*/30 * * * *` | Every 30 min |
| `/api/cron/license-check` | `0 6 * * *` | Daily 06:00 |
| `/api/cron/billing-sync` | `0 */6 * * *` | Every 6h |
| `/api/cron/digest` | `0 7 * * *` | Daily 07:00 |
| `/api/cron/weekly-digest` | `0 8 * * 1` | Mon 08:00 |
| `/api/cron/follow-ups` | `*/15 * * * *` | Every 15 min |
| `/api/cron/permits` | `0 */6 * * *` | Every 6h |
| `/api/cron/review-requests` | `0 10 * * *` | Daily 10:00 |
| `/api/cron/engagement` | `0 3 * * *` | Daily 03:00 |
| `/api/cron/zip-demand` | `0 4 * * *` | Daily 04:00 |
| `/api/cron/enrich` | `*/15 * * * *` | Every 15 min |
| `/api/cron/geocode-backfill` | `*/15 * * * *` | Every 15 min |
| `/api/cron/blast-worker` | `*/5 * * * *` | Every 5 min |
| `/api/cron/market-intel` | `0 4 * * *` | Daily 04:00 |
| `/api/cron/storm-events` | `0 9 * * *` | Daily 09:00 |
| `/api/cron/re-enrich` | `0 2 * * *` | Daily 02:00 |

## Findings

### F1. HEALTHY — CI workflow live and comprehensive
**File**: `.github/workflows/ci.yml`
**Why it matters**: Closes prior #3 priority. Lint + typecheck + truthfulness + test + build all gate merge to main. Placeholder env vars allow build without leaking real secrets to GitHub Actions.
**Status**: No action.

### F2. HEALTHY — Cron coverage comprehensive
**File**: `vercel.json`
**Why it matters**: 17 scheduled jobs cover every recurring background task: scoring, scraping, enrichment, follow-ups, digests, license checks, market intel, storm events. No "what runs this?" gap.
**Status**: No action.

### F3. WATCH — `pnpm migrate` falls back to clipboard-paste
**Files**: `scripts/apply-pending-migrations.ts`, `package.json:14`
**Severity**: Low
**Why it matters**: Script attempts RPC path via `exec_sql(text)` (the auto-bootstrap function in `supabase/_pending-bundle.sql:1-17`) but the function isn't installed in production Supabase. Falls back to writing the bundle to disk + emitting a clipboard-paste prompt. Works but isn't fully automated.
**Recommended fix**: First-run apply of `_pending-bundle.sql` would install `exec_sql` and unlock the RPC path. Once installed, all future migrations apply via `npx tsx scripts/apply-pending-migrations.ts` without paste. ~2 min to install (one-time).

### F4. HEALTHY — `package.json` scripts are well-organized
**File**: `package.json:5-30`
**Why it matters**: 16 scripts including the canonical `dev`/`build`/`start`/`lint`/`test` plus Henri-specific `migrate`/`truthfulness`/`ingest`/`score`/`pipeline`/`backfill-geocode`/`check-pipeline`/`import:catalogs`/`import:perfected`/`import:master-json`/`import:live-master`/`import:dh3-{database-complete,zip-mapping,accela}`/`import:hd-{jurisdictions,sources}`/`coverage:gaps`/`discover:sources`. Each maps to a `scripts/*.ts` file.
**Status**: No action.

### F5. HEALTHY — Build uses placeholder env vars in CI
**File**: `.github/workflows/ci.yml:46-51`
**Why it matters**: Build step sets `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`, `NEXT_PUBLIC_APP_URL=https://henri.app` etc. so `next build` succeeds without leaking real secrets. Production env is set in Vercel dashboard separately.
**Status**: No action.

### F6. WATCH — Working tree has 195+ uncommitted entries
**File**: `git status --short` baseline
**Severity**: Low (operational, not architectural)
**Why it matters**: Most are intentional — script renames into `_archive/`, new importers from this session, audit reports being written. But the volume makes it harder to grep "what changed in this PR" without a more granular commit history.
**Recommended fix**: Land logical chunks as separate commits — (1) script renames + archive cleanup, (2) new importers + provenance migrations, (3) live-data integrations, (4) audit reports. ~30 min if you `git add -p` selectively.

### F7. WATCH — Migration bundle on disk could leak via misconfigured static-assets
**File**: `supabase/_pending-bundle.sql`
**Severity**: Low
**Why it matters**: The `.gitignore` rules exclude `supabase/_pending-bundle.sql` from git tracking, but the file lives on disk during `pnpm migrate` runs. If someone misconfigures Next.js to serve `supabase/` as static (no one does today), the bundle would be web-accessible. Defense in depth: ensure `supabase/` is never part of `next.config.ts` `headers()` allowlist or `public/` symlinked.
**Recommended fix**: Confirm `.gitignore` covers it (it does — line lists `supabase/_pending-bundle.sql`). Optional: delete the file after successful apply via the migrate script.

## Diff vs 2026-04-26

### Closed
- F1 (CI workflow) — was prior #3 priority
- F4 (`pnpm migrate` script) — was prior #9 priority (script exists; the only nit is the RPC vs paste fallback)

### Still open
- F3 (RPC path needs first-time install of `exec_sql`)
- F6 (working tree commit hygiene)
