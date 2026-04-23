-- 00010_roles_and_licenses.sql
-- Role-based auth, homeowner fields, contractor license verification

BEGIN;

-- ── Add role to profiles ──────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'contractor'
  CHECK (role IN ('homeowner', 'contractor', 'admin'));

-- ── Homeowner address fields ──────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS zip varchar(5);

-- ── Contractor license table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_licenses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  license_number      text NOT NULL,
  license_state       text NOT NULL,   -- 2-letter state code (CA, TX, FL, etc.)
  license_type        text,            -- e.g. 'C-39 Roofing', 'General B', etc.
  license_class       text,            -- state-specific classification
  verified            boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed', 'expired', 'revoked')),
  last_checked_at     timestamptz,
  expiry_date         date,
  holder_name         text,            -- name on the license (for cross-check)
  raw_response        jsonb,           -- full API response for audit
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One license per contractor (can add more later)
CREATE INDEX IF NOT EXISTS idx_licenses_contractor ON contractor_licenses (contractor_id);
CREATE INDEX IF NOT EXISTS idx_licenses_state ON contractor_licenses (license_state);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON contractor_licenses (verification_status);

-- RLS: contractors see only their own licenses
ALTER TABLE contractor_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY licenses_select_own ON contractor_licenses
  FOR SELECT USING (auth.uid() = contractor_id);

CREATE POLICY licenses_insert_own ON contractor_licenses
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);

CREATE POLICY licenses_update_own ON contractor_licenses
  FOR UPDATE
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

-- Auto-update timestamps
CREATE OR REPLACE TRIGGER licenses_updated_at
  BEFORE UPDATE ON contractor_licenses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── Update plan enum to include founder ───────────────────────
-- Plans: free (default), founder, starter, pro, enterprise
-- The plan_type enum was created in 00002 as (free, starter, pro, enterprise)
-- We need to add 'founder'
DO $$ BEGIN
  ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'founder' AFTER 'free';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
