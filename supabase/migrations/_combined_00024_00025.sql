-- Combined migration for Henri Data Henri 3 ingest.
-- Paste into Supabase SQL editor: https://supabase.com/dashboard/project/ivfxylgoxgrxttknewsf/sql/new
-- Safe to re-run (all CREATEs are IF NOT EXISTS + policy guards).

BEGIN;

-- 00024: ZIP reference table (public read)
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
    CREATE POLICY zip_reference_select_all ON zip_reference FOR SELECT USING (true);
  END IF;
END $$;

-- 00025: Per-address permit history (authenticated read; service-role write)
CREATE TABLE IF NOT EXISTS address_permit_history (
  address_norm       text PRIMARY KEY,
  address            text,
  city               text,
  state              varchar(2),
  zip                varchar(5),
  permit_count       int NOT NULL,
  total_value        bigint,
  first_permit_date  date,
  last_permit_date   date,
  trades             text[],
  permits            jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aph_zip       ON address_permit_history(zip);
CREATE INDEX IF NOT EXISTS idx_aph_last_date ON address_permit_history(last_permit_date DESC);
CREATE INDEX IF NOT EXISTS idx_aph_cascade   ON address_permit_history(permit_count) WHERE permit_count >= 2;
ALTER TABLE address_permit_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'address_permit_history' AND policyname = 'aph_select_auth'
  ) THEN
    CREATE POLICY aph_select_auth ON address_permit_history FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;
