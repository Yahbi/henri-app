-- 00025_address_permit_history.sql
-- Per-address aggregation of all historical permits loaded into Supabase.
-- One row per normalized address. Consumed by /api/cron/score to populate
-- leads.permit_history, cascade_flag, cascade_count, pipeline_value.

BEGIN;

CREATE TABLE IF NOT EXISTS address_permit_history (
  address_norm       text PRIMARY KEY,            -- lower(trim(address)) + '|' + zip
  address            text,                         -- display form
  city               text,
  state              varchar(2),
  zip                varchar(5),
  permit_count       int NOT NULL,
  total_value        bigint,                       -- sum(estimated_value) in cents, nullable
  first_permit_date  date,
  last_permit_date   date,
  trades             text[],                       -- distinct normalized trades at this address
  permits            jsonb NOT NULL,               -- array of {permit_number, permit_type, applied_date, issued_date, value, status, trade}
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
    CREATE POLICY aph_select_auth ON address_permit_history
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Writes are restricted to service_role (implicit — no INSERT/UPDATE policy granted to authenticated).

COMMIT;
