-- 00003_territories.sql
-- ZIP code territory claiming system
-- Each ZIP has up to 3 slots; contractors can claim, release, or waitlist

BEGIN;

-- Territory status enum
DO $$ BEGIN
  CREATE TYPE territory_status AS ENUM ('active', 'released', 'waitlisted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS territories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip             varchar(5) NOT NULL,
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          territory_status NOT NULL DEFAULT 'active',
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz,
  slot_number     int NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Only one contractor per slot while the territory is active
CREATE UNIQUE INDEX IF NOT EXISTS uq_territories_zip_slot_active
  ON territories (zip, slot_number)
  WHERE status = 'active';

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER territories_updated_at
  BEFORE UPDATE ON territories
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: all authenticated users can read, but only update own rows
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;

CREATE POLICY territories_select_all ON territories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY territories_update_own ON territories
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

CREATE POLICY territories_insert_own ON territories
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = contractor_id);

-- -------------------------------------------------------
-- Waitlist table for ZIP codes at capacity
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS zip_waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip             varchar(5) NOT NULL,
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position        int NOT NULL,
  joined_at       timestamptz NOT NULL DEFAULT now()
);

-- Ensure unique position per ZIP and unique contractor per ZIP waitlist
CREATE UNIQUE INDEX IF NOT EXISTS uq_zip_waitlist_position
  ON zip_waitlist (zip, position);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zip_waitlist_contractor
  ON zip_waitlist (zip, contractor_id);

-- RLS for waitlist
ALTER TABLE zip_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY zip_waitlist_select_all ON zip_waitlist
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY zip_waitlist_insert_own ON zip_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = contractor_id);

CREATE POLICY zip_waitlist_delete_own ON zip_waitlist
  FOR DELETE
  TO authenticated
  USING (auth.uid() = contractor_id);

COMMIT;
