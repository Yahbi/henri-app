-- 00053_permit_source_zip_coverage.sql
--
-- Adds a many-to-many table linking permit_sources to the ZIPs they
-- cover. The new US_COMPREHENSIVE_MASTER.json (~33k ZIPs, ~107k APIs)
-- provides this mapping explicitly — one source can apply to thousands
-- of ZIPs (e.g. a state-level dataset), and one ZIP can be served by
-- many sources (national + state + county + city). Without this table
-- the founder can't answer the question "which sources actually cover
-- ZIP 90210?" without scanning every row.
--
-- Schema is intentionally narrow: composite primary key (source_key, zip),
-- nothing else. Source-level metadata stays on permit_sources.
--
-- Idempotent. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS permit_source_zips (
  source_key text NOT NULL REFERENCES permit_sources(source_key) ON DELETE CASCADE,
  zip        text NOT NULL CHECK (zip ~ '^\d{5}$'),
  -- Granularity hint so consumers know HOW the source applies:
  --   'federal'    — national feed, every ZIP gets it (rare, ~2 sources)
  --   'state'      — state-wide dataset (e.g. data.ny.gov / state.gov)
  --   'county'     — county-level dataset
  --   'city'       — city-level dataset (most numerous)
  --   'unknown'    — could not determine, default
  granularity text NOT NULL DEFAULT 'unknown'
    CHECK (granularity IN ('federal','state','county','city','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, zip)
);

-- Reverse lookup: "give me every source covering ZIP 90210" — the
-- contractor lookup pattern. Fast btree on zip alone.
CREATE INDEX IF NOT EXISTS idx_permit_source_zips_zip
  ON permit_source_zips (zip);

-- Source coverage rollup: "how many ZIPs does this source cover?".
-- Index on source_key supports the SET operation but the PK already
-- includes it, so this is redundant — skip.

-- RLS: all rows readable by authenticated users (this is reference
-- metadata, not lead data). Service role can write.
ALTER TABLE permit_source_zips ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'permit_source_zips'
      AND policyname = 'permit_source_zips_select'
  ) THEN
    CREATE POLICY permit_source_zips_select ON permit_source_zips
      FOR SELECT TO authenticated USING (true);
  END IF;
END$$;

COMMENT ON TABLE permit_source_zips IS
  'Maps permit_sources to the ZIPs they cover. Populated from US_COMPREHENSIVE_MASTER.json zip_index. One source can cover many ZIPs (state-level datasets), one ZIP can be served by many sources (federal + state + county + city stack).';
COMMENT ON COLUMN permit_source_zips.granularity IS
  'How the source applies to this ZIP: federal (every US ZIP), state, county, city. Lets the lead-router prefer city > county > state > federal when fetching.';

COMMIT;
