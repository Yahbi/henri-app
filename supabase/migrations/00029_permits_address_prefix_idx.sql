-- 00029_permits_address_prefix_idx.sql
--
-- Add a text-prefix index on permits.address so the per-property
-- history lookup (/api/permits/history) can use ilike '<street>%'
-- without falling back to a full table scan.
--
-- Context: with ~925k rows (and growing) the prior query hit
-- `canceling statement due to statement timeout` whenever the scraper
-- cron was holding write locks. `text_pattern_ops` gives btree
-- prefix-range support for ILIKE-style leading-literal matches.
--
-- We also add a lower(address) functional index so the case-insensitive
-- lookup stays index-backed regardless of whether the caller sends the
-- address upper-cased (legacy-sqlite ingest) or mixed-case (live feeds).

BEGIN;

-- Functional prefix index — handles ilike 'pattern%' because both
-- sides are lower-cased. PostgREST ilike lowers the pattern server-side,
-- so an expression index on lower(address) varchar_pattern_ops matches
-- the planner's rewrite.
CREATE INDEX IF NOT EXISTS idx_permits_address_lower_prefix
  ON permits (lower(address) varchar_pattern_ops);

-- Composite for the common (zip, address-prefix) two-filter case —
-- the hot path in the drawer. Cheaper than two single-column index
-- lookups + bitmap merge.
CREATE INDEX IF NOT EXISTS idx_permits_zip_address_lower
  ON permits (zip, lower(address) varchar_pattern_ops);

COMMIT;
