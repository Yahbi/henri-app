# 02 — Data layer

## TL;DR

44 migrations, additive-only discipline holding, RLS pattern (`contractor_id = auth.uid()` self-policy) consistently applied on contractor-owned tables. The single pressing issue is **5 pending migrations (00040–00044)** sitting in `supabase/_pending-bundle.sql` that have not been applied to the live Supabase project. The runtime is graceful-degrading correctly (`useLeads` retry-fallback, `WRITE_PROVENANCE` / `WRITE_EXTENDED` env gates), but every day the migrations stay un-applied is a day where the new enrichment columns and voter/ppp tables produce no signal. Apply the bundle.

## Score

**ISSUE** — schema discipline good, deploy queue clogged.

## Migrations on disk vs applied

| Range | Status | Notes |
|---|---|---|
| 00001–00031 | Applied | Core schema, exclusivity locks, permit events, missed-call tracking |
| 00032–00038 | Applied (assumed) | Per session notes |
| 00039 | **PENDING** | `contact_provenance` — adds `contact_source`, `contact_confidence`, `contact_extracted_at` to `permits` + `leads`. App gates writes on `WRITE_PROVENANCE=1` |
| 00040 | **PENDING** | `voter_lookups` |
| 00041 | **PENDING** | `voter_files` — `voter_fl`, `voter_nc`, `voter_oh` tables for the voter-file enrichment source |
| 00042 | **PENDING** | `ppp_loans` table |
| 00043 | **PENDING** | `enrich_indexes` — partial indexes that unblock the burst-enrich cron. Without these, `year_built IS NULL` on 99%+ of leads triggers full-table scans → statement timeouts |
| 00044 | **PENDING** | `leads_enrichment_columns` — 8 new fields (`employer`, `occupation`, `business_phone`, `business_status`, `business_website`, `license_number`, `license_status`, `naics_code`). App gates writes on `WRITE_EXTENDED=1` |

**Apply path:** paste `supabase/_pending-bundle.sql` (386 lines, idempotent, all `IF NOT EXISTS`) into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new — or set `SUPABASE_ACCESS_TOKEN` and run `npx tsx scripts/apply-pending-migrations.ts`.

## Findings

### F1 — 5 pending migrations clogging the deploy queue

- **Severity**: High
- **File**: `supabase/migrations/00039_*.sql` through `00044_*.sql`, `supabase/_pending-bundle.sql`
- **Why it matters**: Three downstream systems are blocked:
  1. Burst-enrich cron is hitting statement timeouts because 00043's partial indexes aren't there (per session notes).
  2. The voter-file and PPP enrichment sources are no-ops in production because their tables don't exist (the lookup functions return `null` early, which is correct, but the data is absent).
  3. The Contractor/Business section in `LeadDetailDrawer` renders empty because `useLeads` is in NARROW mode (column-not-found triggers the cached fallback).
- **Recommendation**: Apply the bundle this week. The 386-line file is mechanically pasteable. Without it, the work in `src/lib/enrichment/orchestrator.ts` (13 sources) is running at ~7-source effective coverage.

### F2 — RLS pattern is textbook on `lead_exclusivity_locks`

- **Severity**: Nitpick (positive)
- **File**: `supabase/migrations/00031_*.sql`
- **Why it matters**: Per architecture-agent confirmation, `lead_exclusivity_locks` has a `contractor_id = auth.uid()` SELECT policy. `permit_events` and `missed_call_events` follow the same pattern. This is the canonical wedge-protection layer (one contractor per permit per trade for 14 days) and it's correctly enforced at the row level, not just at the API gate.
- **Recommendation**: None. Document this pattern in `12-documentation.md` as the reference for future contractor-owned tables (per `CLAUDE.md`: "All new DB tables: `contractor_id uuid REFERENCES profiles(id)` + RLS self-policy").

### F3 — `useLeads` SELECT retry-fallback is the correct pattern under partial-deploy

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts:50-186`
- **Why it matters**: The hook tries `SELECT_WIDE` (with extended columns), and if Supabase errors with "column does not exist", caches `extendedColumnsMissing = true` for the session and retries with `SELECT_NARROW`. This means the dashboard renders correctly whether 00039+00044 are applied or not, single-probe-per-page, no infinite-retry loop. Exactly the pattern `CLAUDE.md` calls for under "Client-side fallback first".
- **Recommendation**: None. Call out in `07-reliability.md` as the reference implementation for future "wide read of optional columns" patterns.

### F4 — Migration apply-path documented in two places, neither is `pnpm migrate`

- **Severity**: Medium
- **File**: `CLAUDE.md` (lines on Migrations), `.claude/commands/migrate.md`, `package.json`
- **Why it matters**: `CLAUDE.md` says "Apply path when Supabase CLI + `SUPABASE_ACCESS_TOKEN` are available: `pnpm migrate`". But `package.json` has no `migrate` script. The `.claude/commands/migrate.md` slash command exists but it requires manual setup. So the documented path doesn't work out-of-box; the working path is the bundle file.
- **Recommendation**: Add `"migrate": "tsx scripts/apply-pending-migrations.ts"` to `package.json` scripts. The script already handles both the RPC path AND the bundle-fallback printing — it's the documented behavior, just unwired from `pnpm`. One line of work, removes a documentation lie.

### F5 — `src/types/lead.ts` mixes DB shape and UI shape

- **Severity**: Medium
- **File**: `src/types/lead.ts`
- **Why it matters**: `Lead` is hybrid: it includes DB columns (`score`, `urgency`, `status`, `permit_id`, `contractor_id`) AND UI-derived fields (`address`, `permit_filed_date`, `permit_age_days`, `latitude`, `longitude` falling back through joined `permits`). The `useLeads` mapping logic at the bottom of the hook synthesizes the UI fields from the joined permit row. This makes `Lead` neither a clean DB row nor a clean view-model. When the schema gains a column, the type author has to figure out whether it's "raw DB" or "derived for UI" — there's no boundary.
- **Recommendation**: Split into `LeadRow` (DB shape, generated from `mcp__supabase__generate_typescript_types`) + `LeadView` (UI shape, manually authored, includes the address/age/lat/lng denorm). The `useLeads` hook's mapping function already exists; this just gives it explicit input/output types instead of an implicit transform.

### F6 — Schema generation not wired (no `supabase gen types`)

- **Severity**: Medium
- **File**: `package.json`, `src/types/`
- **Why it matters**: `mcp__supabase__generate_typescript_types` exists and would emit a fully-typed view of the schema. Henri's hand-authored `Lead` type drifts from the DB whenever a migration adds columns (the 00039 + 00044 columns are read via `Record<string, unknown>` casts because the type doesn't know about them). Auto-generated types would catch column additions at compile time.
- **Recommendation**: Add `pnpm types:db` script that emits `src/types/database.ts` from the live schema. Use those types as the source for `LeadRow`. The 124 `Record<string,unknown>` casts in the codebase shrink dramatically.

### F7 — `_pending-bundle.sql` exists in `supabase/` but isn't `.gitignore`'d

- **Severity**: Low
- **File**: `supabase/_pending-bundle.sql`
- **Why it matters**: Per session notes, this file is auto-generated by `scripts/apply-pending-migrations.ts`. It's checked into git (per `git status` it's untracked, but the user could `git add` it). Bundle files like this should either be ignored (so the working copy is always fresh after a re-run) or named in a way that signals they're committed (e.g., `supabase/release-2026-04-26.sql`). The current name (`_pending-bundle.sql` with a leading underscore) is ambiguous.
- **Recommendation**: Add `supabase/_pending-bundle.sql` to `.gitignore`. The script regenerates it on every run, so checking it in just means stale copies in PR diffs.

### F8 — Cron route reads enrichment columns via raw SELECT but writes via env-gated branch

- **Severity**: Low
- **File**: `src/app/api/cron/enrich/route.ts`
- **Why it matters**: Per session notes, the cron does `is("year_built", null).not("address", "is", null)` to find candidates, then writes via `assign("employer", hit.employer)` ONLY if `process.env.WRITE_EXTENDED === "1"`. The write side is correctly gated (won't fail on missing column), but if `WRITE_EXTENDED=1` is set BEFORE migration 00044 lands, the write WILL fail with a column-not-exists error. The flag's name doesn't communicate "set this only after the migration is applied".
- **Recommendation**: Either rename the env var (e.g., `WRITE_EXTENDED_ENRICHMENT_COLUMNS_REQUIRES_MIGRATION_00044=1` — verbose but unambiguous) or document the precondition in the code comment. Same applies to `WRITE_PROVENANCE` and 00039.

### F9 — Supabase 1000-row cap respected via paginated `.range()` loop

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts:121-178`
- **Why it matters**: PostgREST caps every response at 1000 rows. `useLeads` correctly paginates with `.range(start, end)` when the requested limit exceeds 1000 (god-mode users fetching 5,000 leads). It also rebuilds the query per page (Supabase query builders are single-use after `.range()`). And it has partial-result tolerance: if a later page hits the statement timeout, return what we have rather than throwing.
- **Recommendation**: None. Reference this pattern when other hooks need >1000 rows.

### F10 — No automated test for migration idempotency

- **Severity**: Medium
- **File**: `supabase/migrations/*.sql`
- **Why it matters**: `CLAUDE.md` requires every migration to be re-runnable safely (`IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for enums). 44 migrations × manual review = brittle. A migration that accidentally drops `IF NOT EXISTS` won't break the first apply but will break `_pending-bundle.sql` being re-run after a partial failure.
- **Recommendation**: Add a `scripts/verify-migrations-idempotent.ts` that grep-checks every migration for: `CREATE TABLE` without `IF NOT EXISTS`, `ALTER TABLE` adding `NOT NULL` without a default, `CREATE INDEX` without `IF NOT EXISTS`. Exit non-zero on violation. Wire into CI.

## What's working well

- **Additive-only discipline**: Per architecture-agent's review of all 44 migrations, no destructive `DROP TABLE`, no `RENAME COLUMN` without dual-write, no `ALTER COLUMN ... NOT NULL` without backfill defaults.
- **RLS pattern consistent** across `lead_exclusivity_locks`, `permit_events`, `missed_call_events`, `feedback`, etc. — `contractor_id = auth.uid()` is the universal idiom.
- **Idempotency on recent migrations** (00039, 00044 confirmed): `ADD COLUMN IF NOT EXISTS`, every column nullable.
- **Apply-path script (`scripts/apply-pending-migrations.ts`) handles both the RPC path AND the bundle-print fallback** — graceful regardless of which apply method is available.
- **Graceful-degrade in app code**: `useLeads` retry-fallback, `WRITE_PROVENANCE` / `WRITE_EXTENDED` env gates, table-missing exception swallowing in `/api/feedback` and `/api/exclusivity` — the app keeps rendering even when migrations lag.
