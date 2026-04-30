# 11 — Build & deploy

## TL;DR

`vercel.json` defines 15 cron schedules; `package.json` has lean scripts (`dev`, `build`, `start`, `lint`, `test`, `test:watch`, `test:ci`, `build:analyze`, `ingest`, `score`, `pipeline`, `backfill-geocode`, `check-pipeline`). The build path uses Next.js 16 + Turbopack in dev / webpack in prod. The pressing gaps: **no CI workflow committed** (the 144 tests pass locally but nothing enforces that on PRs), **no `pnpm migrate` script** despite documentation referencing it, and **`instrumentation.ts` is untracked** suggesting incomplete Sentry wiring.

## Score

**WATCH** — solid scripts and cron schedule, missing CI gate is the launch-blocker.

## Findings

### F1 — No CI workflow committed

- **Severity**: High
- **File**: `.github/workflows/` does not exist
- **Why it matters**: `pnpm tsc --noEmit`, `pnpm eslint`, `pnpm vitest run` all pass locally. Without CI, a PR that breaks any of these merges silently. For a Beta product about to take paying customers, the cost of a broken-build deploy is real (Stripe webhooks down, dashboard 500s).
- **Recommendation**: Add `.github/workflows/ci.yml` (assuming GitHub):
  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v3
          with: { version: 9 }
        - uses: actions/setup-node@v4
          with: { node-version: 20, cache: 'pnpm' }
        - run: pnpm install --frozen-lockfile
        - run: pnpm tsc --noEmit
        - run: pnpm lint --max-warnings=0
        - run: pnpm test
  ```
  Block merge on red. 30 minutes of work.

### F2 — `pnpm migrate` is documented but the script doesn't exist

- **Severity**: Medium
- **File**: `package.json` scripts block, `CLAUDE.md` migration section
- **Why it matters**: `CLAUDE.md` says "Apply path: `pnpm migrate`". `package.json` has no `migrate` entry. The `scripts/apply-pending-migrations.ts` file exists and does the right thing, but isn't wired to a script.
- **Recommendation**: Add to `package.json`:
  ```json
  "migrate": "tsx scripts/apply-pending-migrations.ts"
  ```
  One-line change. Removes the documentation lie.

### F3 — `instrumentation.ts` is untracked — incomplete Sentry wiring?

- **Severity**: Medium
- **File**: per `git status`: `?? instrumentation.ts`
- **Why it matters**: See [08-observability.md F9](./08-observability.md). Either it's empty (delete) or half-wired (complete + commit). Untracked instrumentation files are a foot-gun: the Vercel build picks them up if they exist, so an accidental commit could break prod.
- **Recommendation**: Open the file, finish or delete, commit the result.

### F4 — `vercel.json` cron schedule is well-tuned

- **Severity**: Nitpick (positive)
- **File**: `vercel.json`
- **Why it matters**: 15 cron jobs at varied cadences:
  - Daily (`license-check` 6am, `digest` 7am, `engagement` 3am, `zip-demand` 4am, `market-intel` 4am, `review-requests` 10am)
  - Weekly (`weekly-digest` Monday 8am)
  - 2-hourly (`score`)
  - 6-hourly (`billing-sync`, `permits`)
  - 30-minute (`scrape`)
  - 15-minute (`follow-ups`, `enrich`, `geocode-backfill`)
  - 5-minute (`blast-worker`)
  Spread across the hour to avoid thundering-herd on Supabase. Daily jobs at off-peak (3am-10am UTC). No two short-cadence crons collide.
- **Recommendation**: None. Document the schedule rationale in a `vercel.json` top-comment (JSON doesn't support comments, but a sibling `vercel.cron.md` would do).

### F5 — `package.json` heavy deps audit

- **Severity**: Low
- **File**: `package.json` dependencies
- **Why it matters**: Visible heavy deps:
  - `@stripe/stripe-js` (client) + `stripe` (server) — needed
  - `@supabase/ssr` + `@supabase/supabase-js` — needed
  - `@tanstack/react-query` — needed
  - `cobe` (3D globe — used where?)
  - `maplibre-gl` + `pmtiles` (map) — lazy-loaded, OK
  - `recharts` (chart) — single component, OK
  - `openai` (server) — server-only, OK
  - `twilio` (server) — server-only, OK
  - `resend` (server) — server-only, OK
  Two questions: (a) is `cobe` actively used or vestigial? (b) is `pmtiles` paired with a use case beyond the unused `.pmtiles` files in `public/`?
- **Recommendation**: Grep `src/` for `cobe` and `pmtiles` imports. If unused, remove from `package.json` to shrink install + audit surface.

### F6 — `tsconfig.json` modified (per git status) — confirm not regressed

- **Severity**: Low
- **File**: `tsconfig.json`
- **Why it matters**: Per `git status`: `M tsconfig.json`. The file was changed during this session (likely the `.next/dev/types/routes.d.ts` includes/excludes work). Confirm the change is intentional and committed before the next `next build`.
- **Recommendation**: Read the diff. If the change is the routes.d.ts include path (necessary for Next.js 16's type-safe routes feature), commit. If it's something else, evaluate.

### F7 — `eslint.config.mjs` modified

- **Severity**: Low
- **File**: `eslint.config.mjs`
- **Why it matters**: Per `git status`: `M eslint.config.mjs`. Not opened during this audit. Confirm the change is intentional (probably the Next.js 16 + ESLint 9 flat-config migration).
- **Recommendation**: Read the diff. If it's the flat-config migration, document what eslint version is required.

### F8 — `pnpm-lock.yaml` is committed

- **Severity**: Nitpick (positive)
- **File**: `pnpm-lock.yaml`
- **Why it matters**: Committed lockfile is the right call. CI uses `--frozen-lockfile` to ensure reproducible builds.
- **Recommendation**: None.

### F9 — No `Dockerfile` — Vercel-native deploy

- **Severity**: Nitpick (informational)
- **File**: N/A
- **Why it matters**: Henri deploys to Vercel. Vercel handles the build, runtime, cron scheduling, and edge functions. No Dockerfile needed. This is the correct choice for a Next.js + Supabase product.
- **Recommendation**: None. Add to `12-documentation.md` as the deploy story so future contributors don't try to dockerize.

### F10 — `next.config.ts` not opened — verify SSR config + headers

- **Severity**: Medium (cross-references [05-security.md F7-F8](./05-security.md))
- **File**: `next.config.ts`
- **Why it matters**: Security audit recommends adding CSP and security headers via `next.config.ts`'s `headers()` block. Verify it doesn't already have something brittle (e.g., `experimental` flags that won't survive the next Next.js minor version).
- **Recommendation**: Read end-to-end. Confirm only intentional config. Add the security headers per [05-security.md F8](./05-security.md).

### F11 — Heavy use of `dynamic()` for code splitting is correct

- **Severity**: Nitpick (positive)
- **File**: `src/app/(dashboard)/dashboard/page.tsx`, `src/components/map/MapDashboard.tsx`
- **Why it matters**: `MapDashboard` is loaded via `next/dynamic({ ssr: false })` so the map module ships in a separate chunk that only downloads when the user opens the map. Same pattern for several heavy components. This is exactly the Next.js code-splitting story.
- **Recommendation**: None.

### F12 — Untracked `playwright.config.ts` + `e2e/` directory

- **Severity**: Medium
- **File**: per `git status`: `?? playwright.config.ts`, `?? e2e/`
- **Why it matters**: See [09-tests.md F8](./09-tests.md). Either commit + use, or delete. The current state is "scaffold exists but doesn't run".
- **Recommendation**: Decide and act this week.

### F13 — Public assets present but not audited

- **Severity**: Low
- **File**: `public/`, in particular `public/zoning-atlas.pmtiles` and `public/zoning-atlas-summary.json` (untracked)
- **Why it matters**: Untracked binary asset (`.pmtiles`) in `public/` is unusual. PMTiles ship vector map tiles for map overlays; if the file is multi-MB and gets committed accidentally, repo size balloons.
- **Recommendation**: Add `.pmtiles` to `.gitignore` and ensure the file is hosted on a CDN or object store, not in-repo. If it MUST be in-repo, document the size and rationale.

### F14 — `scripts/_archive/` is large (renamed scripts per git status)

- **Severity**: Low
- **File**: `scripts/_archive/` — many `R` (renamed) entries in git status
- **Why it matters**: Per session, several scripts were moved into `_archive/`. This is good cleanup hygiene — keeps the active scripts visible. Risk: `_archive/` could grow indefinitely. After a year, no one knows if `scripts/_archive/sync-desktop-data.ts` is "important historical reference" or "deletable".
- **Recommendation**: Add `scripts/_archive/README.md` with one line per archived script: when archived + why. The README is already untracked (per git status); commit it.

### F15 — Several scripts modified (`bulk-probe-sources.ts`)

- **Severity**: Low
- **File**: `scripts/bulk-probe-sources.ts`
- **Why it matters**: Modified per git status. Likely active development. Confirm the changes are intentional and committed.
- **Recommendation**: Read the diff before merging this session's work.

## What's working well

- **Vercel-native deploy** — no Dockerfile, no custom CI for build, leverages platform.
- **Cron schedule** is well-spread, well-cadenced, no thundering-herd risk.
- **Lean script set** in `package.json` — only what's used.
- **Lockfile committed** for reproducible builds.
- **Bundle analyzer** scaffold (`pnpm build:analyze`) ready for periodic perf check.
- **`tsx`** used as runtime for scripts (no compile step needed) — fast iteration.
