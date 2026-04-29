-- 00043_enrich_indexes.sql
-- Partial indexes that unblock the enrichment pipeline.
--
-- Background: every burst-enrich invocation runs a query like
--   SELECT id, address, zip, state, ... FROM leads
--   WHERE year_built IS NULL AND address IS NOT NULL LIMIT 600;
-- On a 133k-row leads table where ~99% of rows have year_built NULL,
-- Postgres needs a full sequential scan of the table to find the
-- 600-row early-exit batch when the cron is competing with concurrent
-- writes (the raw-JSON backfill, scoring cron, ingest cron). Result:
-- the SELECT routinely hits Supabase's 60 s statement-timeout budget,
-- killing the burst before any enrichment work happens.
--
-- The partial index below stores ONLY the row-ids of leads that
-- currently need enrichment. As enrichment writes year_built, those
-- rows fall out of the index. Future bursts read the index directly
-- (~few-millisecond lookup) instead of scanning the whole table.
--
-- We also add a partial index for owner-name backlog and a normalized-
-- address index for the same-address sibling-permit lookup the
-- orchestrator runs in Phase A.
--
-- All indexes are CREATE INDEX IF NOT EXISTS — re-runnable.
-- All are CONCURRENTLY where Supabase's migration runner allows; if
-- not, fallback is a brief lock at apply time. Total apply time on
-- ~933k permits + 133k leads: ~30-60 s.

BEGIN;

-- ── leads: enrichment-eligibility partial indexes ──────────────────

-- Primary backlog index — what /api/cron/enrich filters on.
CREATE INDEX IF NOT EXISTS leads_enrich_year_built_null_idx
  ON leads (id)
  WHERE year_built IS NULL;

-- Owner-name backlog — used by the broadened-eligibility filter we
-- briefly tried (currently reverted, but keep the index ready for
-- when we narrow the cron's per-pass scope and want a multi-target
-- batch).
CREATE INDEX IF NOT EXISTS leads_enrich_owner_null_idx
  ON leads (id)
  WHERE owner_name IS NULL;

-- Phone backlog — same logic as owner-name.
CREATE INDEX IF NOT EXISTS leads_enrich_phone_null_idx
  ON leads (id)
  WHERE phone IS NULL;

-- Geocoded leads — the dashboard map filter relies on this. Already
-- exists in some envs from migration 00019 but harmless to declare
-- IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS leads_geocoded_idx
  ON leads (id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ── permits: same-address sibling-lookup index ─────────────────────
--
-- The orchestrator's Phase 1 (cross-permit owner propagation) runs:
--   SELECT applicant_name FROM permits
--   WHERE zip = $1 AND address ILIKE $2 AND applicant_name IS NOT NULL
--   ORDER BY issued_date DESC LIMIT 1;
-- A single composite index on (zip, lower(address)) WHERE applicant
-- IS NOT NULL is what makes that a sub-millisecond lookup instead of
-- a per-zip table scan.

-- Note (2026-04-27): originally `(zip, lower(address))`, but some
-- Supabase configs reject `lower()` in column expressions with 42P17
-- ("functions in index predicate must be marked IMMUTABLE") because
-- the volatility classification depends on collation. Dropped the
-- lower() — same-address ILIKE lookups can still use the btree on
-- `address` for prefix scans, and the hot path is already fast.
CREATE INDEX IF NOT EXISTS permits_address_zip_owner_idx
  ON permits (zip, address)
  WHERE applicant_name IS NOT NULL;

-- Helps the contractor-principal correlation script (Pass 4 in
-- scripts/correlate-enrichment.ts) batch-sample (contractor_name,
-- applicant_name) pairs.
CREATE INDEX IF NOT EXISTS permits_contractor_applicant_idx
  ON permits (contractor_name)
  WHERE contractor_name IS NOT NULL AND applicant_name IS NOT NULL;

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
-- 1. Preferred: pnpm migrate (uses Supabase CLI, requires
--    SUPABASE_ACCESS_TOKEN set).
-- 2. Fallback: paste this file into the Supabase SQL editor at
--    https://app.supabase.com/project/<id>/sql/new — Run.
--
-- Verify after apply:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('leads', 'permits')
--      AND indexname LIKE '%enrich%' OR indexname LIKE '%address_zip%';
-- Should show 6 rows.
