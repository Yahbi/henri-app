-- 00004_permits.sql
-- Permits scraped from city open-data portals
-- Includes geospatial location for radius queries

BEGIN;

-- Permit type enum
DO $$ BEGIN
  CREATE TYPE permit_type AS ENUM (
    'residential', 'commercial', 'demolition', 'renovation',
    'new_construction', 'addition', 'repair', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Permit status enum
DO $$ BEGIN
  CREATE TYPE permit_status AS ENUM (
    'submitted', 'approved', 'issued', 'final',
    'expired', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS permits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_city       text NOT NULL,
  source_id         text NOT NULL,
  permit_number     text,
  permit_type       permit_type NOT NULL DEFAULT 'other',
  status            permit_status NOT NULL DEFAULT 'submitted',
  description       text,
  address           text,
  city              text,
  state             text,
  zip               varchar(5),
  location          geography(Point, 4326),
  applicant_name    text,
  contractor_name   text,
  estimated_value   bigint,
  actual_value      bigint,
  applied_date      date,
  approved_date     date,
  issued_date       date,
  completed_date    date,
  raw_json          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Unique per data source to prevent duplicate imports
CREATE UNIQUE INDEX IF NOT EXISTS uq_permits_source
  ON permits (source_city, source_id);

-- Fast lookups by ZIP for territory matching
CREATE INDEX IF NOT EXISTS idx_permits_zip
  ON permits (zip);

-- Geospatial index for radius queries
CREATE INDEX IF NOT EXISTS idx_permits_location
  ON permits USING GIST (location);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER permits_updated_at
  BEFORE UPDATE ON permits
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: all authenticated users can read permits
ALTER TABLE permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY permits_select_all ON permits
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;
