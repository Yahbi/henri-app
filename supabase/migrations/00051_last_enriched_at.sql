-- 00051_last_enriched_at.sql
-- Adds a `last_enriched_at` timestamp to `leads` so the re-enrichment cron
-- can find leads whose contact data is stale.
--
-- Phase 2.6 (2026-04-26 session): the orchestrator gained 4 new free-tier
-- sources (Numverify, Cloudmersive, WeatherStack, Apollo) since most leads
-- were enriched. There's no clean way to find "leads enriched before
-- WeatherStack came online" without a timestamp — so this column lets
-- `/api/cron/re-enrich` (separate from the inflow `/api/cron/enrich`)
-- backfill stale leads on a nightly schedule.
--
-- Strategy:
--   - Nullable column. NULL means "never enriched"; the cron treats NULL
--     and "older than 30 days" as the same cohort.
--   - No default. Setting it to now() on insert would mean every new
--     lead gets backdated; we want it to track ACTUAL enrichment runs,
--     not row creation. The cron updates this column after each run.
--   - Partial index for the cron's hot query: WHERE last_enriched_at IS
--     NULL OR last_enriched_at < (now() - interval '30 days'). The
--     planner can hit this index directly without a sort.
--
-- Idempotent — re-runs are a no-op (IF NOT EXISTS).

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;

-- Hot-path index for the re-enrichment cron. The cron's query selects
-- leads where last_enriched_at IS NULL OR < cutoff. A standard btree
-- index on last_enriched_at handles both clauses (NULLs sort first by
-- default).
CREATE INDEX IF NOT EXISTS leads_last_enriched_at_idx
  ON leads (last_enriched_at NULLS FIRST);

-- No backfill — we explicitly WANT existing rows to read as "never
-- enriched" so the first cron pass sweeps them all. Backfilling to
-- created_at would mark them stale-but-known, and the cron would still
-- re-enrich; this just saves one UPDATE pass and keeps the migration
-- additive-only.

COMMIT;
