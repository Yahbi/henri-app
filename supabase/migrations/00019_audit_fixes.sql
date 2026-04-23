-- 00019_audit_fixes.sql
-- Critical schema fixes: enums, denormalized geo columns, uniqueness,
-- score breakdown, and service-role insert policies.

-- =====================================================================
-- 1. Enum additions (must be their own top-level transaction each,
--    because ALTER TYPE ... ADD VALUE cannot run inside a multi-
--    statement transaction block in PostgreSQL < 16).
-- =====================================================================

-- C3 - notification_type enum -------------------------------------------
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'quote_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'quote_response';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'review_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'license_expiring';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'match';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_updated';

-- Lead urgency enum - add 'cool' between warm and cold ------------------
ALTER TYPE lead_urgency ADD VALUE IF NOT EXISTS 'cool' AFTER 'warm';


-- =====================================================================
-- 2. Everything else runs inside a single transaction.
-- =====================================================================
BEGIN;

-- -----------------------------------------------------------------
-- C4 - Leads table: denormalized geo / permit columns for fast
--      map queries and lead-card display.
-- -----------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS state        text,
  ADD COLUMN IF NOT EXISTS zip          varchar(5),
  ADD COLUMN IF NOT EXISTS permit_type  text,
  ADD COLUMN IF NOT EXISTS permit_value bigint,
  ADD COLUMN IF NOT EXISTS latitude     double precision,
  ADD COLUMN IF NOT EXISTS longitude    double precision;

-- Spatial index for map tile queries on leads
CREATE INDEX IF NOT EXISTS idx_leads_lat_lng
  ON leads (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ZIP index for territory matching on leads
CREATE INDEX IF NOT EXISTS idx_leads_zip
  ON leads (zip);

-- -----------------------------------------------------------------
-- C5 - Permits table: separate lat/lng columns + trigger + backfill
-- -----------------------------------------------------------------
ALTER TABLE permits
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Function that extracts lat/lng from the geography column
CREATE OR REPLACE FUNCTION permits_sync_lat_lng()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location IS NOT NULL THEN
    NEW.latitude  := ST_Y(NEW.location::geometry);
    NEW.longitude := ST_X(NEW.location::geometry);
  END IF;
  RETURN NEW;
END;
$$;

-- Fire on every INSERT or UPDATE that touches `location`
DROP TRIGGER IF EXISTS permits_sync_lat_lng_trigger ON permits;
CREATE TRIGGER permits_sync_lat_lng_trigger
  BEFORE INSERT OR UPDATE OF location ON permits
  FOR EACH ROW
  EXECUTE FUNCTION permits_sync_lat_lng();

-- Backfill existing rows
UPDATE permits
SET latitude  = ST_Y(location::geometry),
    longitude = ST_X(location::geometry)
WHERE location IS NOT NULL
  AND (latitude IS NULL OR longitude IS NULL);

-- Index for simple numeric lat/lng lookups
CREATE INDEX IF NOT EXISTS idx_permits_lat_lng
  ON permits (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- -----------------------------------------------------------------
-- C6 - permit_id uniqueness: allow one lead per permit per contractor
-- -----------------------------------------------------------------
-- Drop the old single-column UNIQUE constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_permit_id_key;

-- Add composite unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_permit_contractor
  ON leads (permit_id, contractor_id);

-- -----------------------------------------------------------------
-- 6. Score breakdown: add missing engagement & conversion components
-- -----------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_engagement int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_conversion int DEFAULT 0;

-- -----------------------------------------------------------------
-- 7. INSERT policy for leads (service role - scoring pipeline)
-- -----------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY leads_insert_service ON leads
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------
-- 8. INSERT policy for notifications (service role)
-- -----------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY notifications_insert_service ON notifications
    FOR INSERT
    TO service_role
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
