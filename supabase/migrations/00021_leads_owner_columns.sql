-- 00021_leads_owner_columns.sql
-- Add owner name columns to leads (referenced by TypeScript Lead type
-- and sequence engine but never created in prior migrations).
-- Also add permit_description for lead card display.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS owner_name          text,
  ADD COLUMN IF NOT EXISTS owner_first         text,
  ADD COLUMN IF NOT EXISTS owner_last          text,
  ADD COLUMN IF NOT EXISTS permit_description  text,
  ADD COLUMN IF NOT EXISTS is_homeowner_intake boolean DEFAULT false;

-- Index for owner name searches
CREATE INDEX IF NOT EXISTS idx_leads_owner_name
  ON leads (owner_name)
  WHERE owner_name IS NOT NULL;

COMMIT;
