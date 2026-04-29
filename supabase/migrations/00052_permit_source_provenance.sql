-- 00052_permit_source_provenance.sql
--
-- Adds provenance + curation metadata to `permit_sources` so we can
-- bulk-import the two third-party catalogs (US_COMPREHENSIVE_MASTER.csv,
-- nationwide_permit_apis.csv) without polluting the active scrape pool.
--
-- Why it matters:
--   The existing seed migrations (00014, 00022, 00023) hand-curated ~25
--   sources with verified field mappings. When we ingest 6.4k+ candidate
--   endpoints from the new CSVs, we need columns to:
--     1. Track WHERE each row came from (CSV import vs hand-seeded vs
--        manual) so we can later re-import without clobbering verified
--        rows.
--     2. Track WHETHER the field mapping is verified, so the scrape cron
--        keeps ignoring rows whose schema we haven't probed yet.
--     3. Allow founder-driven prioritization (e.g. "scrape Tampa next").
--
-- The cron (`getActiveSources` in src/lib/scrapers/sources-db.ts) already
-- filters on `enabled=true`, so newly imported rows with `enabled=false`
-- never run until promoted. These columns are pure metadata that survives
-- re-imports without breaking anything.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE permit_sources
  ADD COLUMN IF NOT EXISTS discovered_via       text,
  ADD COLUMN IF NOT EXISTS field_mapping_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS priority             int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imported_at          timestamptz,
  ADD COLUMN IF NOT EXISTS notes                text;

-- Existing hand-seeded rows are presumed verified (00023 explicitly
-- repaired their mappings). Don't touch already-verified rows.
UPDATE permit_sources
SET field_mapping_status = 'verified'
WHERE field_mapping_status = 'unknown'
  AND id_field    IS NOT NULL
  AND date_field  IS NOT NULL
  AND address_field IS NOT NULL
  AND enabled = true;

-- Constraint: the status enum keeps drift in check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permit_sources_field_mapping_status_chk'
  ) THEN
    ALTER TABLE permit_sources
      ADD CONSTRAINT permit_sources_field_mapping_status_chk
      CHECK (field_mapping_status IN ('verified','probed','unknown','failed','deprecated'));
  END IF;
END$$;

-- Speed up the founder's "show me staged sources for state X" query.
CREATE INDEX IF NOT EXISTS idx_permit_sources_pending
  ON permit_sources (state, field_mapping_status, priority DESC)
  WHERE enabled = false;

COMMENT ON COLUMN permit_sources.discovered_via IS
  'Where this row was sourced from. Examples: ''hand_seeded'', ''us_master_csv'', ''nationwide_csv'', ''manual_admin''. NULL for legacy rows.';
COMMENT ON COLUMN permit_sources.field_mapping_status IS
  'Lifecycle of the field mapping. ''verified'' = hit live and confirmed schema. ''probed'' = hit live but not field-mapped. ''unknown'' = bulk-imported, never touched. ''failed'' = endpoint returned non-JSON / 4xx repeatedly. ''deprecated'' = upstream removed dataset.';
COMMENT ON COLUMN permit_sources.priority IS
  'Higher = scraped sooner once enabled. Founder uses this to surface "scrape Tampa next" without flipping the enable bit on 50 sources at once.';

COMMIT;
