-- 00036_permits_issued_date_idx.sql
--
-- Single-column index on permits.issued_date so the market-intel
-- aggregate (and any other recency-scoped queries) can do an
-- index-backed scan instead of a full seq+sort of the 925k-row table.
--
-- Before: `.gte("issued_date", sinceIso)` + `.order(issued_date desc)`
--         took ~8s for 1000 rows, and `refresh_market_intel_zip()`
--         timed out on Supabase's 8s statement_timeout.
-- After:  same query should be sub-second.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_permits_issued_date
  ON permits (issued_date DESC NULLS LAST);

-- Force a PostgREST schema reload so the new index is picked up
-- immediately (some planner paths cache the schema).
NOTIFY pgrst, 'reload schema';

COMMIT;
