-- 00013_permit_sources.sql
-- Adds scored_at + source_type to permits table
-- Creates permit_sources table for DB-driven live scraping config

BEGIN;

-- ── Add missing columns to permits ────────────────────────────────────────────

ALTER TABLE permits
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS scored_at   timestamptz;

-- Index for score cron (finds unscored permits fast)
CREATE INDEX IF NOT EXISTS idx_permits_unscored
  ON permits (scored_at)
  WHERE scored_at IS NULL;

-- Index for state-based queries (territory lookup)
CREATE INDEX IF NOT EXISTS idx_permits_state_zip
  ON permits (state, zip);

-- ── permit_sources: stores all live API scraping configurations ───────────────
-- Replaces the hardcoded PERMIT_SOURCES array in sources.ts
-- Allows enabling/disabling sources without code changes

CREATE TABLE IF NOT EXISTS permit_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key      text UNIQUE NOT NULL,  -- stable identifier (e.g. 'socrata_chicago')
  name            text NOT NULL,
  state           text NOT NULL,
  city            text,
  jurisdiction    text,
  endpoint        text NOT NULL,         -- full API URL
  source_type     text NOT NULL,         -- 'socrata' | 'arcgis' | 'ckan' | 'csv'
  auth            text NOT NULL DEFAULT 'none', -- 'none' | 'socrata_token' | 'api_key'
  update_freq     text,                  -- 'daily' | 'weekly' | 'monthly'

  -- Field mapping (Socrata / CKAN sources)
  id_field        text,
  type_field      text,
  status_field    text,
  desc_field      text,
  address_field   text,
  date_field      text,
  value_field     text,
  lat_field       text,
  lng_field       text,

  -- ArcGIS-specific: feature service layer URL
  -- endpoint already stores the base; layer_index used for /query path
  layer_index     int DEFAULT 0,

  enabled         boolean NOT NULL DEFAULT true,
  last_scraped_at timestamptz,
  last_count      int,                   -- rows returned on last scrape
  error_count     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Order by least-recently scraped to spread load evenly
CREATE INDEX IF NOT EXISTS idx_permit_sources_scrape_order
  ON permit_sources (enabled, last_scraped_at ASC NULLS FIRST);

-- RLS: only service role can manage sources
ALTER TABLE permit_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY permit_sources_select ON permit_sources
  FOR SELECT TO authenticated USING (true);

COMMIT;
