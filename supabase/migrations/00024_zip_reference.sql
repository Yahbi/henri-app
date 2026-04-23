-- 00024_zip_reference.sql
-- US ZIP code reference table (public read).
-- Used by territory UX, coverage analytics, and ZIP parsing helpers.

BEGIN;

CREATE TABLE IF NOT EXISTS zip_reference (
  zipcode     varchar(5) PRIMARY KEY,
  city        text,
  county      text,
  state       varchar(2) NOT NULL,
  state_fips  text,
  state_name  text
);

CREATE INDEX IF NOT EXISTS idx_zip_reference_state      ON zip_reference(state);
CREATE INDEX IF NOT EXISTS idx_zip_reference_city_lower ON zip_reference(lower(city));

ALTER TABLE zip_reference ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zip_reference' AND policyname = 'zip_reference_select_all'
  ) THEN
    CREATE POLICY zip_reference_select_all ON zip_reference
      FOR SELECT USING (true);
  END IF;
END $$;

COMMIT;
