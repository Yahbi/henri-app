-- Henri App — Combined Migration (idempotent v6)


-- === 00001_extensions.sql ===
-- 00001_extensions.sql
-- Enable required PostgreSQL extensions for Henri App
-- uuid-ossp: UUID generation
-- postgis: geospatial queries for permit locations
-- pg_cron: scheduled jobs (scraping, scoring)
-- pg_net: HTTP requests from database (webhooks, notifications)
-- moddatetime: automatic updated_at triggers

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "moddatetime";

COMMIT;


-- === 00002_profiles.sql ===
-- 00002_profiles.sql
-- Contractor profiles linked to Supabase Auth
-- Includes trade specialization, subscription plan, and Stripe billing IDs

BEGIN;

-- Trade enum
DO $$ BEGIN
  CREATE TYPE trade_type AS ENUM (
    'general', 'roofing', 'plumbing', 'electrical',
    'hvac', 'solar', 'landscaping', 'painting',
    'concrete', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Plan enum
DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM (
    'free', 'starter', 'pro', 'enterprise'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id                     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  text NOT NULL,
  full_name              text,
  company_name           text,
  phone                  text,
  trade                  trade_type NOT NULL DEFAULT 'general',
  plan                   plan_type NOT NULL DEFAULT 'free',
  stripe_customer_id     text,
  stripe_subscription_id text,
  onboarding_completed   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: users can read and update only their own row
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMIT;


-- === 00003_territories.sql ===
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

DROP POLICY IF EXISTS territories_select_all ON territories;
CREATE POLICY territories_select_all ON territories
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS territories_update_own ON territories;
CREATE POLICY territories_update_own ON territories
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

DROP POLICY IF EXISTS territories_insert_own ON territories;
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

DROP POLICY IF EXISTS zip_waitlist_select_all ON zip_waitlist;
CREATE POLICY zip_waitlist_select_all ON zip_waitlist
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS zip_waitlist_insert_own ON zip_waitlist;
CREATE POLICY zip_waitlist_insert_own ON zip_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = contractor_id);

DROP POLICY IF EXISTS zip_waitlist_delete_own ON zip_waitlist;
CREATE POLICY zip_waitlist_delete_own ON zip_waitlist
  FOR DELETE
  TO authenticated
  USING (auth.uid() = contractor_id);

COMMIT;


-- === 00004_permits.sql ===
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

DROP POLICY IF EXISTS permits_select_all ON permits;
CREATE POLICY permits_select_all ON permits
  FOR SELECT
  TO authenticated
  USING (true);

COMMIT;


-- === 00005_leads.sql ===
-- 00005_leads.sql
-- AI-scored leads derived from permits, assigned to contractors
-- Each permit generates at most one lead per contractor

BEGIN;

-- Lead urgency enum
DO $$ BEGIN
  CREATE TYPE lead_urgency AS ENUM ('hot', 'warm', 'cold');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lead status enum
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new', 'contacted', 'won', 'lost', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id        uuid NOT NULL REFERENCES permits(id) ON DELETE CASCADE UNIQUE,
  contractor_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score            int NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_reasoning  text,
  score_model      text,
  urgency          lead_urgency NOT NULL DEFAULT 'cold',
  status           lead_status NOT NULL DEFAULT 'new',
  contacted_at     timestamptz,
  won_at           timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups for contractor dashboard
CREATE INDEX IF NOT EXISTS idx_leads_contractor
  ON leads (contractor_id);

-- Sorting and filtering by score
CREATE INDEX IF NOT EXISTS idx_leads_score
  ON leads (score DESC);

-- Filtering by urgency
CREATE INDEX IF NOT EXISTS idx_leads_urgency
  ON leads (urgency);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: users see only their own leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select_own ON leads;
CREATE POLICY leads_select_own ON leads
  FOR SELECT
  USING (auth.uid() = contractor_id);

DROP POLICY IF EXISTS leads_update_own ON leads;
CREATE POLICY leads_update_own ON leads
  FOR UPDATE
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

COMMIT;


-- === 00006_notifications.sql ===
-- 00006_notifications.sql
-- In-app notifications for contractors
-- Supports new leads, territory availability, billing alerts, and system messages

BEGIN;

-- Notification type enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'new_lead', 'territory_available', 'billing_alert', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       text NOT NULL,
  body        text,
  read        boolean NOT NULL DEFAULT false,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup for user's notification feed
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);

-- Filter unread notifications quickly
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id)
  WHERE read = false;

-- RLS: users see only their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;


-- === 00007_billing_events.sql ===
-- 00007_billing_events.sql
-- Stripe webhook event log for billing history and audit trail
-- Each event is stored exactly once via the stripe_event_id unique constraint

BEGIN;

CREATE TABLE IF NOT EXISTS billing_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_event_id   text NOT NULL UNIQUE,
  event_type        text NOT NULL,
  amount            bigint,
  currency          text NOT NULL DEFAULT 'usd',
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup for user's billing history
CREATE INDEX IF NOT EXISTS idx_billing_events_user
  ON billing_events (user_id, created_at DESC);

-- Lookup by Stripe event ID for idempotent webhook processing
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe
  ON billing_events (stripe_event_id);

-- RLS: users see only their own billing events
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_events_select_own ON billing_events;
CREATE POLICY billing_events_select_own ON billing_events
  FOR SELECT
  USING (auth.uid() = user_id);

COMMIT;


-- === 00008_ziplock_rpc.sql ===
-- 00008_ziplock_rpc.sql
-- RPC functions for atomic ZIP territory operations
-- claim_territory: grab the next open slot (max 3 per ZIP)
-- release_territory: release a slot and auto-promote the first waitlister
-- get_zip_availability: return current slot and waitlist status as JSON

BEGIN;

-- -------------------------------------------------------
-- 1. claim_territory(p_zip, p_contractor_id)
--    Atomically claims the next available slot (1-3).
--    Returns the assigned slot_number.
--    Raises an exception if all 3 slots are taken.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_territory(
  p_zip           varchar(5),
  p_contractor_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot int;
  v_existing int;
BEGIN
  -- Prevent duplicate active claims by the same contractor in this ZIP
  SELECT slot_number INTO v_existing
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  IF FOUND THEN
    RAISE EXCEPTION 'Contractor already holds an active territory in ZIP %', p_zip;
  END IF;

  -- Find the lowest available slot (1, 2, or 3)
  SELECT s.n INTO v_slot
    FROM (VALUES (1),(2),(3)) AS s(n)
   WHERE NOT EXISTS (
     SELECT 1 FROM territories
      WHERE zip = p_zip
        AND slot_number = s.n
        AND status = 'active'
   )
   ORDER BY s.n
   LIMIT 1
   FOR UPDATE;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'All 3 slots are taken for ZIP %', p_zip;
  END IF;

  INSERT INTO territories (zip, contractor_id, status, slot_number, claimed_at)
  VALUES (p_zip, p_contractor_id, 'active', v_slot, now());

  -- Remove from waitlist if they were waiting
  DELETE FROM zip_waitlist
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id;

  RETURN v_slot;
END;
$$;

-- -------------------------------------------------------
-- 2. release_territory(p_zip, p_contractor_id)
--    Releases the contractor's active slot and promotes
--    the first person on the waitlist into that slot.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION release_territory(
  p_zip           varchar(5),
  p_contractor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot          int;
  v_next_id       uuid;
  v_next_wl_id    uuid;
BEGIN
  -- Find and lock the active territory row
  SELECT slot_number INTO v_slot
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active territory found for contractor in ZIP %', p_zip;
  END IF;

  -- Mark the territory as released
  UPDATE territories
     SET status = 'released',
         released_at = now()
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  -- Check for a waitlisted contractor (first in line)
  SELECT id, contractor_id INTO v_next_wl_id, v_next_id
    FROM zip_waitlist
   WHERE zip = p_zip
   ORDER BY position ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    -- Promote the waitlister into the freed slot
    INSERT INTO territories (zip, contractor_id, status, slot_number, claimed_at)
    VALUES (p_zip, v_next_id, 'active', v_slot, now());

    -- Remove the promoted contractor from the waitlist
    DELETE FROM zip_waitlist WHERE id = v_next_wl_id;

    -- Re-sequence remaining waitlist positions
    WITH renumbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS new_pos
        FROM zip_waitlist
       WHERE zip = p_zip
    )
    UPDATE zip_waitlist w
       SET position = r.new_pos
      FROM renumbered r
     WHERE w.id = r.id;

    -- Notify the promoted contractor
    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
      v_next_id,
      'territory_available',
      'Territory claimed!',
      'You have been promoted from the waitlist for ZIP ' || p_zip,
      jsonb_build_object('zip', p_zip, 'slot_number', v_slot)
    );
  END IF;
END;
$$;

-- -------------------------------------------------------
-- 3. get_zip_availability(p_zip)
--    Returns JSON with current slot usage, contractor list,
--    and waitlist count for a given ZIP code.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_zip_availability(
  p_zip varchar(5)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'zip',          p_zip,
    'slots_used',   COALESCE(active.cnt, 0),
    'slots_total',  3,
    'contractors',  COALESCE(active.contractors, '[]'::jsonb),
    'waitlist_count', COALESCE(wl.cnt, 0)
  ) INTO v_result
  FROM
    (SELECT 1) AS dummy
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS cnt,
      jsonb_agg(
        jsonb_build_object(
          'contractor_id', t.contractor_id,
          'slot_number',   t.slot_number,
          'claimed_at',    t.claimed_at
        ) ORDER BY t.slot_number
      ) AS contractors
    FROM territories t
    WHERE t.zip = p_zip AND t.status = 'active'
  ) active ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM zip_waitlist
    WHERE zip = p_zip
  ) wl ON true;

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION claim_territory(varchar, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION release_territory(varchar, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_zip_availability(varchar) TO authenticated;

COMMIT;


-- === 00009_schema_v2.sql ===
-- 00009_schema_v2.sql
-- Extend leads with property data, score breakdown, pipeline stages
-- Add homeowner_intakes, outreach_logs, estimates tables

BEGIN;

-- ── Extend lead_status enum with pipeline stages ──────────────
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'quoted' AFTER 'contacted';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'proposal' AFTER 'quoted';

COMMIT;

-- New transaction (enum values require separate transaction)
BEGIN;

-- ── Extend leads table ────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS property_value    bigint,
  ADD COLUMN IF NOT EXISTS assessed_value    bigint,
  ADD COLUMN IF NOT EXISTS year_built        int,
  ADD COLUMN IF NOT EXISTS lot_sqft          text,
  ADD COLUMN IF NOT EXISTS home_sqft         text,
  ADD COLUMN IF NOT EXISTS owner_since       text,
  ADD COLUMN IF NOT EXISTS owner_occupied    boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS co_owner          text,
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS phone2            text,
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS email2            text,
  ADD COLUMN IF NOT EXISTS mailing_address   text,
  ADD COLUMN IF NOT EXISTS permit_history    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cascade_flag      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cascade_count     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_freshness   int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_value       int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_contact     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_demand      int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade             text,
  ADD COLUMN IF NOT EXISTS pipeline_value    bigint;

-- Index for cascade filtering
CREATE INDEX IF NOT EXISTS idx_leads_cascade
  ON leads (cascade_flag) WHERE cascade_flag = true;

-- Index for trade filtering
CREATE INDEX IF NOT EXISTS idx_leads_trade
  ON leads (trade);

-- Index for pipeline status
CREATE INDEX IF NOT EXISTS idx_leads_status
  ON leads (status);

-- ── Homeowner intakes (portal chat submissions) ───────────────
CREATE TABLE IF NOT EXISTS homeowner_intakes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip                   varchar(5) NOT NULL,
  trade                 text NOT NULL,
  timeline              text,
  budget_range          text,
  description           text,
  refinement_answers    jsonb DEFAULT '[]'::jsonb,
  photos                text[] DEFAULT '{}',
  contact_name          text,
  contact_phone         text,
  contact_email         text,
  henri_score           int CHECK (henri_score BETWEEN 0 AND 100),
  matched_contractor_id uuid REFERENCES profiles(id),
  matched_lead_id       uuid REFERENCES leads(id),
  status                text NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intakes_zip ON homeowner_intakes (zip);
CREATE INDEX IF NOT EXISTS idx_intakes_contractor ON homeowner_intakes (matched_contractor_id);

-- RLS: contractors see intakes matched to them, service role can insert
ALTER TABLE homeowner_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intakes_select_matched ON homeowner_intakes;
CREATE POLICY intakes_select_matched ON homeowner_intakes
  FOR SELECT
  USING (auth.uid() = matched_contractor_id);

-- Allow anonymous inserts (from portal)
DROP POLICY IF EXISTS intakes_insert_anon ON homeowner_intakes;
CREATE POLICY intakes_insert_anon ON homeowner_intakes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── Outreach logs (SMS/email tracking) ────────────────────────
CREATE TABLE IF NOT EXISTS outreach_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
  template_name   text,
  subject         text,
  content         text,
  recipient       text,
  status          text NOT NULL DEFAULT 'sent',
  sent_at         timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  replied_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outreach_lead ON outreach_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_contractor ON outreach_logs (contractor_id);

ALTER TABLE outreach_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outreach_select_own ON outreach_logs;
CREATE POLICY outreach_select_own ON outreach_logs
  FOR SELECT USING (auth.uid() = contractor_id);

DROP POLICY IF EXISTS outreach_insert_own ON outreach_logs;
CREATE POLICY outreach_insert_own ON outreach_logs
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);

-- ── Estimates (line-item builder) ─────────────────────────────
CREATE TABLE IF NOT EXISTS estimates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           text,
  line_items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal        bigint DEFAULT 0,
  tax_rate        numeric(5,4) DEFAULT 0,
  total           bigint DEFAULT 0,
  notes           text,
  status          text NOT NULL DEFAULT 'draft',
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimates_contractor ON estimates (contractor_id);
CREATE INDEX IF NOT EXISTS idx_estimates_lead ON estimates (lead_id);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimates_select_own ON estimates;
CREATE POLICY estimates_select_own ON estimates
  FOR SELECT USING (auth.uid() = contractor_id);

DROP POLICY IF EXISTS estimates_insert_own ON estimates;
CREATE POLICY estimates_insert_own ON estimates
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);

DROP POLICY IF EXISTS estimates_update_own ON estimates;
CREATE POLICY estimates_update_own ON estimates
  FOR UPDATE
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

-- Auto-update timestamps
CREATE OR REPLACE TRIGGER intakes_updated_at
  BEFORE UPDATE ON homeowner_intakes
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE OR REPLACE TRIGGER estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMIT;


-- === 00010_roles_and_licenses.sql ===
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

DROP POLICY IF EXISTS licenses_select_own ON contractor_licenses;
CREATE POLICY licenses_select_own ON contractor_licenses
  FOR SELECT USING (auth.uid() = contractor_id);

DROP POLICY IF EXISTS licenses_insert_own ON contractor_licenses;
CREATE POLICY licenses_insert_own ON contractor_licenses
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);

DROP POLICY IF EXISTS licenses_update_own ON contractor_licenses;
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


-- === 00011_estimates_and_blasts.sql ===
-- Migration 00011: Estimates, blast campaigns, outreach templates

-- ── Estimates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  address         text,
  line_items      jsonb NOT NULL DEFAULT '[]',
  subtotal        numeric(12,2) DEFAULT 0,
  tax_rate        numeric(5,2) DEFAULT 8.75,
  total           numeric(12,2) DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','accepted','declined')),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimates_contractor_id_idx ON estimates(contractor_id);
CREATE INDEX IF NOT EXISTS estimates_lead_id_idx ON estimates(lead_id);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractor sees own estimates" ON estimates;
CREATE POLICY "contractor sees own estimates"
  ON estimates FOR ALL
  USING (contractor_id = auth.uid());

-- ── Blast Campaigns ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blast_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  job_type        text,
  radius_miles    numeric(4,2) DEFAULT 0.5,
  target_count    integer DEFAULT 0,
  channels        jsonb NOT NULL DEFAULT '{"sms":true,"email":true}',
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','sent','failed')),
  sent_at         timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blast_campaigns_contractor_id_idx ON blast_campaigns(contractor_id);

ALTER TABLE blast_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractor sees own blasts" ON blast_campaigns;
CREATE POLICY "contractor sees own blasts"
  ON blast_campaigns FOR ALL
  USING (contractor_id = auth.uid());

-- ── Outreach Templates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  subject         text,
  body            text NOT NULL DEFAULT '',
  channel         text NOT NULL DEFAULT 'email'
                    CHECK (channel IN ('email','sms','both')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_templates_contractor_id_idx ON outreach_templates(contractor_id);

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractor sees own templates" ON outreach_templates;
CREATE POLICY "contractor sees own templates"
  ON outreach_templates FOR ALL
  USING (contractor_id = auth.uid());

-- ── Moddatetime triggers ──────────────────────────────────────────────────
CREATE TRIGGER set_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER set_outreach_templates_updated_at
  BEFORE UPDATE ON outreach_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── Notification prefs column on profiles ─────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb DEFAULT '{
    "new_lead_sms": true,
    "new_lead_email": true,
    "license_expiry": true,
    "payment_receipts": true,
    "weekly_digest": false
  }',
  ADD COLUMN IF NOT EXISTS insurance_expiry date,
  ADD COLUMN IF NOT EXISTS review_links jsonb DEFAULT '{}';


-- === 00012_prod_hardening.sql ===
-- 00012_prod_hardening.sql
-- Production hardening: auto-profile creation, indexes, constraints

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. profiles: allow users to INSERT their own row
--    (needed for self-registration and OAuth profile creation)
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY profiles_insert_own ON profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. profiles: unique constraint on stripe_customer_id
--    Prevents two profiles sharing a Stripe customer, which would
--    cause billing sync to update the wrong contractor's plan.
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_profiles_stripe_customer'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT uq_profiles_stripe_customer
      UNIQUE (stripe_customer_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. profiles: add role column for homeowner vs contractor routing
--    (migrates any existing rows to 'contractor' as default)
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('contractor', 'homeowner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'contractor';

-- ──────────────────────────────────────────────────────────────
-- 4. leads: compound indexes for dashboard query patterns
-- ──────────────────────────────────────────────────────────────

-- (contractor_id, status) — used in pipeline view with status filter
CREATE INDEX IF NOT EXISTS idx_leads_contractor_status
  ON leads (contractor_id, status);

-- (contractor_id, created_at DESC) — used for recent leads sorting
CREATE INDEX IF NOT EXISTS idx_leads_contractor_created
  ON leads (contractor_id, created_at DESC);

-- (contractor_id, score DESC) — primary dashboard sort
CREATE INDEX IF NOT EXISTS idx_leads_contractor_score
  ON leads (contractor_id, score DESC);

-- ──────────────────────────────────────────────────────────────
-- 5. Auto-create profile on new auth user (fallback trigger)
--    This fires whenever Supabase Auth inserts a new user,
--    covering cases where the HTTP webhook may not fire.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, plan, onboarding_completed)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' = 'homeowner' THEN 'homeowner'::user_role
      ELSE 'contractor'::user_role
    END,
    'free',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger to ensure it's current
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────
-- 6. territories: index for intake → contractor lookup
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_territories_zip_status
  ON territories (zip, status)
  WHERE status = 'active';

COMMIT;


-- === 00013_permit_sources.sql ===
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

DROP POLICY IF EXISTS permit_sources_select ON permit_sources;
CREATE POLICY permit_sources_select ON permit_sources
  FOR SELECT TO authenticated USING (true);

COMMIT;


-- === 00014_seed_permit_sources.sql ===
-- 00014_seed_permit_sources.sql
-- Seeds top permit data API sources into permit_sources table
-- Priority: daily update frequency, no/free auth, Socrata first (scraper ready), then ArcGIS

BEGIN;

INSERT INTO permit_sources (source_key, name, state, city, jurisdiction, endpoint, source_type, auth, update_freq, id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field)
VALUES

-- ── SOCRATA SOURCES (daily) ───────────────────────────────────────────────────

('socrata_chicago',    'Chicago Building Permits',             'IL', 'Chicago',      'City of Chicago',        'https://data.cityofchicago.org/resource/ydr8-5enu.json',       'socrata', 'socrata_token', 'daily',  'id',            'permit_type',      'permit_status',   'work_description',  'street_address',   'issue_date',    'reported_cost',      'latitude',  'longitude'),
('socrata_la',         'Los Angeles Building Permits',         'CA', 'Los Angeles',  'City of Los Angeles',    'https://data.lacity.org/resource/nbyu-2ha9.json',              'socrata', 'socrata_token', 'weekly', 'pcis_permit',   'permit_type',      'status',          'work_description',  'address',          'issue_date',    'valuation',          'latitude',  'longitude'),
('socrata_nyc',        'New York City Building Permits',       'NY', 'New York',     'City of New York',       'https://data.cityofnewyork.us/resource/ipu4-2vj7.json',        'socrata', 'socrata_token', 'daily',  'job__',         'job_type',         'job_status',      'job_description',   'house__street_name','filing_date',   'initial_cost',       'latitude',  'longitude'),
('socrata_houston',    'Houston Building Permits',             'TX', 'Houston',      'City of Houston',        'https://data.houstontx.gov/resource/4wij-ktsw.json',           'socrata', 'socrata_token', 'daily',  'match_id',      'permit_type',      'status_current',  'project_description','street_address',  'applied_date',  'estimated_value',    'latitude',  'longitude'),
('socrata_phoenix',    'Phoenix Building Permits',             'AZ', 'Phoenix',      'City of Phoenix',        'https://data.phoenix.gov/resource/m5q3-fxjn.json',             'socrata', 'socrata_token', 'daily',  'permit_number', 'type',             'status',          'description',       'address',          'applied_date',  'valuation',          'latitude',  'longitude'),
('socrata_denver',     'Denver Building Permits',              'CO', 'Denver',       'City of Denver',         'https://data.denvergov.org/resource/c5tk-bn43.json',           'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type_name', 'status',          'work_description',  'full_address',     'issue_date',    'value',              'latitude',  'longitude'),
('socrata_austin',     'Austin Construction Permits',          'TX', 'Austin',       'City of Austin',         'https://data.austintexas.gov/resource/3syk-w9eu.json',         'socrata', 'socrata_token', 'daily',  'permitnum',     'workclass',        'status_current',  'description',       'original_address1','applied_date',  'total_valuation',    'latitude',  'longitude'),
('socrata_seattle',    'Seattle Building Permits',             'WA', 'Seattle',      'City of Seattle',        'https://data.seattle.gov/resource/76t5-zqzr.json',             'socrata', 'socrata_token', 'daily',  'permitnum',     'permitclass',      'statuscurrent',   'description',       'originaladdress1', 'applieddate',   'estprojectcost',     'latitude',  'longitude'),
('socrata_seattle_lu', 'Seattle Land Use Permits',             'WA', 'Seattle',      'City of Seattle',        'https://data.seattle.gov/resource/uyyd-8gak.json',             'socrata', 'socrata_token', 'daily',  'applicationno', 'permitclass',      'statuscurrent',   'description',       'originaladdress1', 'applieddate',   'estprojectcost',     'latitude',  'longitude'),
('socrata_baltimore',  'Baltimore Building Permits',           'MD', 'Baltimore',    'City of Baltimore',      'https://data.baltimorecity.gov/resource/fesm-tgxf.json',       'socrata', 'socrata_token', 'daily',  'permitno',      'permittype',       'statusdate',      'description',       'propertyaddress',  'dateissued',    'projectedcost',      'lat',       'lng'),
('socrata_miami_dade', 'Miami-Dade Building Permits',         'FL', 'Miami',        'Miami-Dade County',      'https://opendata.miamidade.gov/resource/vvw2-gpfq.json',       'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type',      'permit_status',   'scope_of_work',     'site_address',     'issue_date',    'estimated_value',    'latitude',  'longitude'),
('socrata_cincinnati', 'Cincinnati Building Permits',         'OH', 'Cincinnati',   'City of Cincinnati',     'https://data.cincinnati-oh.gov/resource/uhjb-xac9.json',       'socrata', 'socrata_token', 'daily',  'apnbr',         'ptype',            'pstatus',         'pdesc',             'siteaddr',         'appldt',        'dclaredvalu',        'lat',       'lng'),
('socrata_sf',         'San Francisco Building Permits',      'CA', 'San Francisco','City of San Francisco',  'https://data.sfgov.org/resource/i98e-djp9.json',               'socrata', 'socrata_token', 'weekly', 'permit_number', 'permit_type',      'status',          'description',       'street_address',   'filed_date',    'estimated_cost',     'latitude',  'longitude'),
('socrata_santa_monica','Santa Monica Building Permits',      'CA', 'Santa Monica', 'City of Santa Monica',   'https://data.smgov.net/resource/ng8m-khuz.json',               'socrata', 'socrata_token', 'weekly', 'permit_no',     'permit_type',      'status',          'description',       'address',          'issue_date',    'valuation',          'lat',       'lon'),
('socrata_berkeley',   'Berkeley Building Permits',           'CA', 'Berkeley',     'City of Berkeley',       'https://data.cityofberkeley.info/resource/q6ea-cfdd.json',     'socrata', 'socrata_token', 'weekly', 'permitid',      'type',             'statename',       'description',       'location',         'issuedate',     'valueconstruction',  'latitude',  'longitude'),
('socrata_nola',       'New Orleans Permits',                 'LA', 'New Orleans',  'City of New Orleans',    'https://data.nola.gov/resource/bhcb-iugi.json',                'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type',      'permit_status',   'description',       'site_address',     'issue_date',    'estimated_value',    'latitude',  'longitude'),
('socrata_nashville',  'Nashville Building Permits',          'TN', 'Nashville',    'City of Nashville',      'https://data.nashville.gov/resource/3h5w-q8b7.json',           'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type',      'status',          'description',       'address',          'permit_date',   'estimated_cost',     'latitude',  'longitude'),
('socrata_louisville', 'Louisville Building Permits',         'KY', 'Louisville',   'City of Louisville',     'https://data.louisvilleky.gov/resource/e56e-cqyv.json',        'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type',      'status',          'work_description',  'street_address',   'issue_date',    'declared_valuation', 'latitude',  'longitude'),
('socrata_honolulu',   'Honolulu Building Permits',           'HI', 'Honolulu',     'City of Honolulu',       'https://data.honolulu.gov/resource/eb2h-h5x9.json',            'socrata', 'socrata_token', 'daily',  'permit_number', 'permit_type',      'status',          'description',       'address',          'issue_date',    'estimated_value',    'latitude',  'longitude'),
('socrata_montgomery', 'Montgomery County Permits',           'MD', 'Rockville',    'Montgomery County MD',   'https://data.montgomerycountymd.gov/resource/au8e-bpsa.json',  'socrata', 'socrata_token', 'daily',  'permitno',      'type',             'status',          'description',       'stno',             'issuedate',     'buildingvalue',      'latitude',  'longitude'),
('socrata_sd',         'San Diego Building Permits',          'CA', 'San Diego',    'City of San Diego',      'https://data.sandiego.gov/resource/a4vq-h4bd.json',            'socrata', 'none',          'daily',  'permitno',      'type',             'status',          'scope',             'address',          'issue_dt',      'value',              'lat',       'lng'),
('socrata_cleveland',  'Cleveland Building Permits',          'OH', 'Cleveland',    'City of Cleveland',      'https://data.clevelandohio.gov/resource/4iud-ynrb.json',       'socrata', 'socrata_token', 'weekly', 'permit_number', 'permit_type',      'permit_status',   'work_description',  'street_address',   'issue_date',    'estimated_cost',     'latitude',  'longitude'),
('socrata_jersey',     'Jersey City Permits',                 'NJ', 'Jersey City',  'City of Jersey City',    'https://data.jerseycitynj.gov/resource/uvgi-kub4.json',        'socrata', 'socrata_token', 'weekly', 'record_id',     'type',             'status',          'description',       'address',          'date_issued',   'job_value',          'latitude',  'longitude'),
('socrata_milwaukee',  'Milwaukee Building Permits',          'WI', 'Milwaukee',    'City of Milwaukee',      'https://data.milwaukee.gov/resource/b7uh-s5a7.json',           'socrata', 'socrata_token', 'weekly', 'permit_number', 'type',             'status',          'description',       'address',          'issue_date',    'estimated_cost',     'latitude',  'longitude'),
('socrata_buffalo',    'Buffalo Building Permits',            'NY', 'Buffalo',      'City of Buffalo',        'https://data.buffalony.gov/resource/2iak-jxvb.json',           'socrata', 'socrata_token', 'weekly', 'permit_number', 'type',             'status',          'description',       'address',          'issue_date',    'estimated_cost',     'latitude',  'longitude'),

-- ── ARCGIS SOURCES ────────────────────────────────────────────────────────────

('arcgis_atlanta',     'Atlanta Building Permits',            'GA', 'Atlanta',      'City of Atlanta',        'https://dpcd.coaplangis.opendata.arcgis.com/datasets/permits/FeatureServer/0', 'arcgis', 'none', 'weekly', 'PERMIT_NUMBER', 'PERMIT_TYPE', 'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'ESTIMATED_VALUE', NULL, NULL),
('arcgis_arlington',   'Arlington VA Building Permits',       'VA', 'Arlington',    'Arlington County VA',    'https://gisdata-arlgis.opendata.arcgis.com/datasets/permits/FeatureServer/0',  'arcgis', 'none', 'weekly', 'PERMIT_NUM',   'PERMIT_TYPE', 'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUED_DATE','VALUATION',       NULL, NULL),
('arcgis_durham',      'Durham NC Building Permits',          'NC', 'Durham',       'City of Durham',         'https://live-durhamnc.opendata.arcgis.com/datasets/permits/FeatureServer/0',   'arcgis', 'none', 'weekly', 'PERMIT_NUM',   'PERMIT_TYPE', 'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'VALUATION',       NULL, NULL),
('arcgis_tampa',       'Tampa Building Permits',              'FL', 'Tampa',        'City of Tampa',          'https://gis-tampagov.opendata.arcgis.com/datasets/permits/FeatureServer/0',     'arcgis', 'none', 'weekly', 'PERMITNUM',    'PERMITTYPE',  'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUEDATE',  'COST',            NULL, NULL),
('arcgis_sanjose',     'San Jose Building Permits',           'CA', 'San Jose',     'City of San Jose',       'https://gisdata-csj.opendata.arcgis.com/datasets/permits/FeatureServer/0',      'arcgis', 'none', 'weekly', 'PERMIT_NUM',   'PERMIT_TYPE', 'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'VALUE',           NULL, NULL),
('arcgis_houston',     'Houston Building Permits (GIS)',      'TX', 'Houston',      'City of Houston',        'https://cohgis-mycity.opendata.arcgis.com/datasets/permits/FeatureServer/0',   'arcgis', 'none', 'weekly', 'PERMIT_NUMBER','TYPE',        'STATUS', 'DESCRIPTION', 'ADDRESS', 'APPL_DATE',  'VALUE',           NULL, NULL),
('arcgis_aurora',      'Aurora CO Building Permits',          'CO', 'Aurora',       'City of Aurora',         'https://data-auroraco.opendata.arcgis.com/datasets/permits/FeatureServer/0',   'arcgis', 'none', 'weekly', 'PERMIT_NUM',   'PERMIT_TYPE', 'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'VALUE',           NULL, NULL),
('arcgis_fairfax',     'Fairfax County Building Permits',     'VA', 'Fairfax',      'Fairfax County VA',      'https://data-fairfaxcountygis.opendata.arcgis.com/datasets/permits/FeatureServer/0', 'arcgis', 'none', 'weekly', 'PERMIT_NO', 'TYPE',      'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'VALUE',           NULL, NULL),
('arcgis_stpete',      'St Petersburg FL Building Permits',   'FL', 'St Petersburg','City of St Petersburg',  'https://stpete.maps.arcgis.com/apps/opsdashboard/index.html#/permits/FeatureServer/0', 'arcgis', 'none', 'weekly', 'PERMIT_NUM', 'TYPE',    'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUED',     'VALUE',           NULL, NULL),
('arcgis_knoxville',   'Knoxville Building Permits',          'TN', 'Knoxville',    'City of Knoxville',      'https://data-cityofknoxville.opendata.arcgis.com/datasets/permits/FeatureServer/0', 'arcgis', 'none', 'weekly', 'PERMIT_NO', 'TYPE',      'STATUS', 'DESCRIPTION', 'ADDRESS', 'ISSUE_DATE', 'VALUE',           NULL, NULL)

ON CONFLICT (source_key) DO NOTHING;

COMMIT;


-- === 00015_referrals.sql ===
-- 00015_referrals.sql
-- Referral system: codes, tracking, credit issuance

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. referral_codes — one per contractor, auto-generated
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_referral_code       UNIQUE (code),
  CONSTRAINT uq_referral_contractor UNIQUE (contractor_id)
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY referral_codes_select ON referral_codes
    FOR SELECT TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referral_codes_insert ON referral_codes
    FOR INSERT TO authenticated
    WITH CHECK (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. referrals — tracks each referral event
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE referral_type   AS ENUM ('contractor', 'homeowner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('invited', 'signed_up', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_email  text NOT NULL,
  referred_name   text,
  referred_user_id uuid REFERENCES profiles(id),
  type            referral_type NOT NULL DEFAULT 'contractor',
  status          referral_status NOT NULL DEFAULT 'invited',
  reward_amount   numeric(10,2),
  reward_label    text,
  reward_issued   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  converted_at    timestamptz,

  CONSTRAINT uq_referral_pair UNIQUE (referrer_id, referred_email)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_email    ON referrals(referred_email);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY referrals_select ON referrals
    FOR SELECT TO authenticated
    USING (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referrals_insert ON referrals
    FOR INSERT TO authenticated
    WITH CHECK (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referrals_update ON referrals
    FOR UPDATE TO authenticated
    USING (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. Add referral_code column to profiles for signup tracking
-- ──────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by text;

-- ──────────────────────────────────────────────────────────────
-- 4. RPC: get_or_create_referral_code
--    Returns the contractor's referral code, creating it if needed
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_or_create_referral_code(p_contractor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code
    FROM referral_codes
   WHERE contractor_id = p_contractor_id;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  v_code := 'HENRI-' || upper(substr(p_contractor_id::text, 1, 6));

  INSERT INTO referral_codes (contractor_id, code)
  VALUES (p_contractor_id, v_code)
  ON CONFLICT (contractor_id) DO NOTHING;

  SELECT code INTO v_code
    FROM referral_codes
   WHERE contractor_id = p_contractor_id;

  RETURN v_code;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. RPC: process_referral_signup
--    Called when a new user signs up with a referral code
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_referral_signup(
  p_referral_code text,
  p_new_user_id uuid,
  p_new_user_email text,
  p_new_user_role text DEFAULT 'contractor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_ref_type referral_type;
  v_reward_amount numeric(10,2);
  v_reward_label text;
BEGIN
  -- Look up referral code owner
  SELECT contractor_id INTO v_referrer_id
    FROM referral_codes
   WHERE code = p_referral_code;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Determine reward based on role
  IF p_new_user_role = 'contractor' THEN
    v_ref_type := 'contractor';
    v_reward_label := '1 month free';
    v_reward_amount := 0; -- Credit applied via Stripe
  ELSE
    v_ref_type := 'homeowner';
    v_reward_label := '$50 credit';
    v_reward_amount := 50.00;
  END IF;

  -- Upsert referral record
  INSERT INTO referrals (referrer_id, referred_email, referred_user_id, type, status, reward_label, reward_amount)
  VALUES (v_referrer_id, p_new_user_email, p_new_user_id, v_ref_type, 'signed_up', v_reward_label, v_reward_amount)
  ON CONFLICT (referrer_id, referred_email)
  DO UPDATE SET
    referred_user_id = EXCLUDED.referred_user_id,
    status = 'signed_up',
    reward_label = EXCLUDED.reward_label,
    reward_amount = EXCLUDED.reward_amount;

  -- Mark the new user's profile with the referral code
  UPDATE profiles SET referred_by = p_referral_code WHERE id = p_new_user_id;

  -- Notify the referrer
  INSERT INTO notifications (user_id, type, title, body, read)
  VALUES (
    v_referrer_id,
    'referral',
    'Your referral signed up',
    p_new_user_email || ' just signed up using your referral link.',
    false
  );

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'type', v_ref_type::text,
    'reward_label', v_reward_label
  );
END;
$$;

COMMIT;


-- === 00016_marketplace_engine.sql ===
-- 00016_marketplace_engine.sql
-- Marketplace infrastructure: reviews, quotes, job lifecycle,
-- engagement scoring, follow-up automation, cost benchmarks, ZIP demand

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. REVIEWS — real review collection, not Google scraping
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id),
  reviewer_name   text NOT NULL,
  reviewer_email  text,
  reviewer_phone  text,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           text,
  body            text,
  trade           text,
  zip             text,
  sentiment       text CHECK (sentiment IN ('positive','neutral','negative')),
  ai_response     text,
  response_sent   boolean NOT NULL DEFAULT false,
  verified        boolean NOT NULL DEFAULT false,
  source          text NOT NULL DEFAULT 'henri' CHECK (source IN ('henri','google','yelp','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reviews_contractor ON reviews(contractor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating     ON reviews(contractor_id, rating);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY reviews_select_public ON reviews
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reviews_insert ON reviews
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reviews_update_own ON reviews
    FOR UPDATE TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 2. REVIEW REQUESTS — automated post-job review solicitation
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE review_request_status AS ENUM ('pending','sent','completed','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id),
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  channel         text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','both')),
  status          review_request_status NOT NULL DEFAULT 'pending',
  token           text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  review_id       uuid REFERENCES reviews(id),
  sent_at         timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_token ON review_requests(token);
CREATE INDEX IF NOT EXISTS idx_review_requests_contractor   ON review_requests(contractor_id);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY review_requests_own ON review_requests
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 3. QUOTES — homeowner ↔ contractor quote flow
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('requested','draft','sent','viewed','accepted','declined','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  homeowner_id    uuid REFERENCES profiles(id),
  intake_id       uuid REFERENCES homeowner_intakes(id),
  lead_id         uuid REFERENCES leads(id),

  -- Project details
  trade           text NOT NULL,
  zip             text NOT NULL,
  description     text,
  scope_notes     text,

  -- Pricing (Good/Better/Best)
  tier_good       jsonb,   -- { label, total, line_items: [] }
  tier_better     jsonb,
  tier_best       jsonb,
  selected_tier   text CHECK (selected_tier IN ('good','better','best')),

  -- Financing
  financing_available boolean NOT NULL DEFAULT false,
  monthly_payment     numeric(10,2),

  -- Status
  status          quote_status NOT NULL DEFAULT 'requested',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  viewed_at       timestamptz,
  responded_at    timestamptz,
  expires_at      timestamptz DEFAULT (now() + interval '14 days'),

  -- Metadata
  message         text,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_contractor ON quotes(contractor_id);
CREATE INDEX IF NOT EXISTS idx_quotes_homeowner  ON quotes(homeowner_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status     ON quotes(contractor_id, status);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY quotes_contractor ON quotes
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY quotes_homeowner ON quotes
    FOR SELECT TO authenticated
    USING (homeowner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 4. JOB MILESTONES — track job lifecycle from contract to payment
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('upcoming','in_progress','completed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES profiles(id),
  title           text NOT NULL,
  description     text,
  sort_order      smallint NOT NULL DEFAULT 0,
  status          milestone_status NOT NULL DEFAULT 'upcoming',
  scheduled_date  date,
  completed_date  date,
  payment_amount  numeric(10,2),
  payment_status  text CHECK (payment_status IN ('pending','invoiced','paid')),
  photos          text[],
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_lead ON job_milestones(lead_id);

ALTER TABLE job_milestones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY milestones_contractor ON job_milestones
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 5. FOLLOW-UP SEQUENCES — automated drip outreach
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS follow_up_sequences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  trigger_status  text NOT NULL,  -- lead status that starts the sequence
  steps           jsonb NOT NULL DEFAULT '[]',
  -- steps: [{ delay_hours, channel, template, subject, body }]
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE follow_up_sequences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY sequences_own ON follow_up_sequences
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Outreach queue: individual scheduled messages from sequences
CREATE TABLE IF NOT EXISTS outreach_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id),
  lead_id         uuid NOT NULL REFERENCES leads(id),
  sequence_id     uuid REFERENCES follow_up_sequences(id),
  step_index      smallint NOT NULL DEFAULT 0,
  channel         text NOT NULL CHECK (channel IN ('email','sms')),
  recipient       text NOT NULL,
  subject         text,
  body            text NOT NULL,
  scheduled_for   timestamptz NOT NULL,
  sent_at         timestamptz,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_queue_scheduled
  ON outreach_queue(scheduled_for)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_outreach_queue_contractor
  ON outreach_queue(contractor_id);

ALTER TABLE outreach_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY outreach_queue_own ON outreach_queue
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 6. ENGAGEMENT SCORES — predict churn, rank contractors
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS engagement_scores (
  contractor_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  login_score       smallint NOT NULL DEFAULT 0,    -- 0-25
  lead_action_score smallint NOT NULL DEFAULT 0,    -- 0-25
  outreach_score    smallint NOT NULL DEFAULT 0,    -- 0-25
  conversion_score  smallint NOT NULL DEFAULT 0,    -- 0-25
  total_score       smallint NOT NULL DEFAULT 0,    -- 0-100
  tier              text NOT NULL DEFAULT 'bronze',
  churn_risk        text NOT NULL DEFAULT 'low' CHECK (churn_risk IN ('low','medium','high','critical')),
  last_login        timestamptz,
  last_lead_action  timestamptz,
  leads_30d         int NOT NULL DEFAULT 0,
  contacted_30d     int NOT NULL DEFAULT 0,
  won_30d           int NOT NULL DEFAULT 0,
  revenue_30d       numeric(12,2) NOT NULL DEFAULT 0,
  avg_response_h    numeric(6,1),
  close_rate        numeric(5,2),
  computed_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE engagement_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY engagement_own ON engagement_scores
    FOR SELECT TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 7. ZIP DEMAND SCORES — territory intelligence
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS zip_demand_scores (
  zip               text PRIMARY KEY,
  permits_30d       int NOT NULL DEFAULT 0,
  permits_trend_pct numeric(6,2),  -- MoM %
  avg_project_value numeric(12,2),
  contractor_density smallint NOT NULL DEFAULT 0,
  demand_score      smallint NOT NULL DEFAULT 0,  -- 0-100
  competition_level text NOT NULL DEFAULT 'medium'
    CHECK (competition_level IN ('low','medium','high','saturated')),
  top_trade         text,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- 8. COST BENCHMARKS — regional pricing data for estimator
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cost_benchmarks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade           text NOT NULL,
  project_type    text NOT NULL,
  zip_prefix      text NOT NULL,  -- first 3 digits of ZIP
  cost_low        numeric(10,2) NOT NULL,
  cost_avg        numeric(10,2) NOT NULL,
  cost_high       numeric(10,2) NOT NULL,
  unit            text NOT NULL DEFAULT 'project',  -- project, sqft, linear_ft
  sample_size     int NOT NULL DEFAULT 0,
  last_updated    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_benchmark UNIQUE (trade, project_type, zip_prefix)
);

-- ══════════════════════════════════════════════════════════════
-- 9. CONTRACTOR PUBLIC PROFILE fields on profiles table
-- ══════════════════════════════════════════════════════════════
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio              text,
  ADD COLUMN IF NOT EXISTS service_area     text[],
  ADD COLUMN IF NOT EXISTS specialties      text[],
  ADD COLUMN IF NOT EXISTS years_experience smallint,
  ADD COLUMN IF NOT EXISTS portfolio_photos text[],
  ADD COLUMN IF NOT EXISTS avg_rating       numeric(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_time_h  numeric(6,1),
  ADD COLUMN IF NOT EXISTS jobs_completed   int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_public   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS badge_licensed   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_insured    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_background boolean DEFAULT false;

-- ══════════════════════════════════════════════════════════════
-- 10. MATERIALIZED VIEW: contractor leaderboard
-- ══════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS contractor_leaderboard AS
SELECT
  p.id,
  p.company_name,
  p.trade,
  p.avg_rating,
  p.review_count,
  p.jobs_completed,
  p.response_time_h,
  p.badge_licensed,
  p.badge_insured,
  p.badge_background,
  p.verified_at,
  COALESCE(e.total_score, 0) AS engagement_score,
  COALESCE(e.close_rate, 0)  AS close_rate,
  COALESCE(e.revenue_30d, 0) AS revenue_30d,
  array_agg(DISTINCT t.zip) FILTER (WHERE t.zip IS NOT NULL) AS territory_zips
FROM profiles p
LEFT JOIN engagement_scores e ON e.contractor_id = p.id
LEFT JOIN territories t ON t.contractor_id = p.id AND t.status = 'active'
WHERE p.role = 'contractor'
  AND p.onboarding_completed = true
GROUP BY p.id, p.company_name, p.trade, p.avg_rating, p.review_count,
         p.jobs_completed, p.response_time_h, p.badge_licensed, p.badge_insured,
         p.badge_background, p.verified_at, e.total_score, e.close_rate, e.revenue_30d;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_id ON contractor_leaderboard(id);

-- ══════════════════════════════════════════════════════════════
-- 11. RPC: refresh_contractor_stats
--     Updates avg_rating, review_count, response_time on profiles
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_contractor_stats(p_contractor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_avg    numeric(3,2);
  v_count  int;
  v_resp_h numeric(6,1);
  v_jobs   int;
BEGIN
  -- Reviews
  SELECT COALESCE(AVG(rating), 0), COUNT(*)
    INTO v_avg, v_count
    FROM reviews
   WHERE contractor_id = p_contractor_id;

  -- Response time (median of last 30 leads)
  SELECT COALESCE(
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (contacted_at - created_at)) / 3600
    ), NULL)
    INTO v_resp_h
    FROM (
      SELECT contacted_at, created_at
        FROM leads
       WHERE contractor_id = p_contractor_id
         AND contacted_at IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 30
    ) sub;

  -- Jobs completed
  SELECT COUNT(*) INTO v_jobs
    FROM leads
   WHERE contractor_id = p_contractor_id
     AND status = 'won';

  UPDATE profiles SET
    avg_rating      = v_avg,
    review_count    = v_count,
    response_time_h = v_resp_h,
    jobs_completed  = v_jobs
  WHERE id = p_contractor_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 12. SEED COST BENCHMARKS (national averages by trade)
-- ══════════════════════════════════════════════════════════════
INSERT INTO cost_benchmarks (trade, project_type, zip_prefix, cost_low, cost_avg, cost_high, unit, sample_size)
VALUES
  -- Roofing
  ('roofing', 'Full Roof Replacement', '900', 8500, 12500, 22000, 'project', 340),
  ('roofing', 'Full Roof Replacement', '902', 9200, 14000, 25000, 'project', 280),
  ('roofing', 'Full Roof Replacement', '100', 7500, 11000, 18000, 'project', 420),
  ('roofing', 'Full Roof Replacement', '606', 6800, 10200, 16500, 'project', 310),
  ('roofing', 'Full Roof Replacement', '770', 6200, 9500, 15000, 'project', 350),
  ('roofing', 'Roof Repair', '900', 350, 850, 2500, 'project', 890),
  ('roofing', 'Roof Repair', '100', 300, 750, 2200, 'project', 920),
  -- HVAC
  ('hvac', 'AC Replacement', '900', 4200, 7500, 12000, 'project', 450),
  ('hvac', 'AC Replacement', '100', 3800, 6500, 11000, 'project', 380),
  ('hvac', 'AC Replacement', '606', 3500, 6000, 10500, 'project', 290),
  ('hvac', 'AC Replacement', '770', 3200, 5800, 9500, 'project', 520),
  ('hvac', 'Furnace Replacement', '900', 3000, 5500, 9000, 'project', 310),
  ('hvac', 'Full HVAC System', '900', 8000, 15000, 28000, 'project', 180),
  -- Plumbing
  ('plumbing', 'Whole House Repipe', '900', 4500, 8000, 15000, 'project', 210),
  ('plumbing', 'Whole House Repipe', '100', 3800, 7200, 13000, 'project', 190),
  ('plumbing', 'Water Heater', '900', 1200, 2200, 4500, 'project', 680),
  ('plumbing', 'Sewer Line', '900', 3000, 6500, 15000, 'project', 140),
  -- Electrical
  ('electrical', 'Panel Upgrade', '900', 1800, 3200, 5500, 'project', 320),
  ('electrical', 'Panel Upgrade', '100', 1500, 2800, 5000, 'project', 290),
  ('electrical', 'Whole House Rewire', '900', 8000, 15000, 30000, 'project', 95),
  ('electrical', 'EV Charger Install', '900', 800, 1500, 3000, 'project', 410),
  -- Kitchen
  ('general remodel', 'Kitchen Remodel', '900', 25000, 45000, 85000, 'project', 240),
  ('general remodel', 'Kitchen Remodel', '100', 22000, 40000, 75000, 'project', 220),
  ('general remodel', 'Kitchen Remodel', '606', 18000, 35000, 65000, 'project', 180),
  -- Bathroom
  ('general remodel', 'Bathroom Remodel', '900', 12000, 22000, 45000, 'project', 350),
  ('general remodel', 'Bathroom Remodel', '100', 10000, 18000, 38000, 'project', 310),
  -- ADU
  ('adu', 'ADU Construction', '900', 120000, 200000, 350000, 'project', 85),
  ('adu', 'ADU Construction', '100', 95000, 165000, 280000, 'project', 60),
  -- Solar
  ('solar', 'Residential Solar', '900', 15000, 22000, 35000, 'project', 520),
  ('solar', 'Residential Solar', '100', 12000, 18000, 28000, 'project', 380),
  ('solar', 'Solar + Battery', '900', 25000, 38000, 55000, 'project', 210),
  -- Windows
  ('windows', 'Full Window Replacement', '900', 8000, 15000, 30000, 'project', 270),
  ('windows', 'Full Window Replacement', '100', 7000, 12000, 24000, 'project', 240),
  -- Painting
  ('painting', 'Exterior Paint', '900', 3500, 6500, 12000, 'project', 480),
  ('painting', 'Interior Paint', '900', 2000, 4500, 9000, 'project', 560),
  -- Foundation
  ('foundation', 'Foundation Repair', '900', 5000, 12000, 30000, 'project', 120),
  ('foundation', 'Foundation Repair', '770', 4000, 9500, 22000, 'project', 140),
  -- Landscaping
  ('landscaping', 'Full Landscape', '900', 8000, 20000, 50000, 'project', 190),
  ('landscaping', 'Hardscape/Patio', '900', 5000, 12000, 30000, 'project', 220)
ON CONFLICT (trade, project_type, zip_prefix) DO NOTHING;

COMMIT;


-- === 00017_follow_up_sequence_instances.sql ===
-- 00017_follow_up_sequence_instances.sql
-- Extend follow_up_sequences to support per-lead sequence instances
-- driven by the automated sequence engine.

BEGIN;

-- Add columns needed by the sequence engine
ALTER TABLE follow_up_sequences
  ADD COLUMN IF NOT EXISTS lead_id              uuid REFERENCES leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sequence_template_id text,
  ADD COLUMN IF NOT EXISTS variables            jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_step         smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','completed_early','cancelled')),
  ADD COLUMN IF NOT EXISTS started_at           timestamptz NOT NULL DEFAULT now();

-- Index for cron: quickly find all active sequences
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_active
  ON follow_up_sequences(status)
  WHERE status = 'active';

-- Index for dedup: prevent duplicate template+lead combos
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_lead_template
  ON follow_up_sequences(lead_id, sequence_template_id);

-- Index for looking up sequences by lead
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_lead
  ON follow_up_sequences(lead_id);

COMMIT;


-- === 00018_intake_matches_and_indexes.sql ===
-- 00018_intake_matches_and_indexes.sql
-- Intake matches table (multi-contractor matching results)
-- Plus missing indexes for common query patterns across the codebase

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. INTAKE MATCHES — stores multi-contractor matching results
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS intake_matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id       uuid NOT NULL REFERENCES homeowner_intakes(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score           numeric NOT NULL DEFAULT 0,
  factors         jsonb DEFAULT '[]'::jsonb,
  rank            integer NOT NULL DEFAULT 0,
  is_primary      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'notified', 'viewed', 'quoted', 'declined')),
  notified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(intake_id, contractor_id)
);

-- Indexes for intake_matches
CREATE INDEX IF NOT EXISTS idx_intake_matches_intake
  ON intake_matches(intake_id);

CREATE INDEX IF NOT EXISTS idx_intake_matches_contractor
  ON intake_matches(contractor_id);

-- Enable RLS on new table
ALTER TABLE intake_matches ENABLE ROW LEVEL SECURITY;

-- Contractors can see their own matches
DROP POLICY IF EXISTS "Contractors see own matches" ON intake_matches;
CREATE POLICY "Contractors see own matches" ON intake_matches
  FOR SELECT USING (contractor_id = auth.uid());

-- Homeowners can see matches for their intakes
DROP POLICY IF EXISTS "Homeowners see own intake matches" ON intake_matches;
CREATE POLICY "Homeowners see own intake matches" ON intake_matches
  FOR SELECT USING (
    intake_id IN (
      SELECT id FROM homeowner_intakes
      WHERE contact_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );


-- ══════════════════════════════════════════════════════════════
-- 2. MISSING INDEXES — identified from codebase query patterns
-- ══════════════════════════════════════════════════════════════

-- NOTE: The following indexes already exist and are NOT recreated:
--   idx_leads_contractor_status  (00012)  — leads(contractor_id, status)
--   idx_leads_contractor_created (00012)  — leads(contractor_id, created_at DESC)
--   idx_leads_trade              (00009)  — leads(trade)
--   idx_leads_score              (00005)  — leads(score DESC)
--   idx_quotes_contractor        (00016)  — quotes(contractor_id)
--   idx_quotes_homeowner         (00016)  — quotes(homeowner_id)
--   idx_reviews_contractor       (00016)  — reviews(contractor_id)
--   idx_territories_zip_status   (00012)  — territories(zip, status) WHERE active
--   idx_outreach_queue_scheduled (00016)  — outreach_queue(scheduled_for) WHERE queued
--   idx_outreach_queue_contractor(00016)  — outreach_queue(contractor_id)
--   engagement_scores PK is contractor_id — already indexed

-- leads: ZIP-based filtering — moved to 00019 (zip column added there first)

-- quotes: compound index for recent-quotes-per-contractor queries
CREATE INDEX IF NOT EXISTS idx_quotes_contractor_recent
  ON quotes(contractor_id, created_at DESC);

-- reviews: compound index for recent-reviews-per-contractor queries
CREATE INDEX IF NOT EXISTS idx_reviews_contractor_recent
  ON reviews(contractor_id, created_at DESC);

-- outreach_queue: lead-level lookup (follow-up dedup, outreach history)
CREATE INDEX IF NOT EXISTS idx_outreach_queue_lead
  ON outreach_queue(lead_id);

-- outreach_queue: status + scheduled_for for cron processing
CREATE INDEX IF NOT EXISTS idx_outreach_queue_status_scheduled
  ON outreach_queue(status, scheduled_for);

-- notifications: compound (user_id, read) for unread-count queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read);

-- follow_up_sequences: status lookup (already has partial idx on active)
CREATE INDEX IF NOT EXISTS idx_follow_up_sequences_status
  ON follow_up_sequences(status);

-- territories: plain ZIP lookup (no status filter, for analytics joins)
CREATE INDEX IF NOT EXISTS idx_territories_zip
  ON territories(zip);

-- territories: contractor + status for "my territories" queries
CREATE INDEX IF NOT EXISTS idx_territories_contractor
  ON territories(contractor_id, status);

-- cost_benchmarks: zip_prefix + trade for estimator lookups
CREATE INDEX IF NOT EXISTS idx_cost_benchmarks_zip
  ON cost_benchmarks(zip_prefix, trade);

COMMIT;


-- === 00019_audit_fixes.sql ===
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


-- === 00020_outreach_tracking.sql ===
/* ── Outreach Delivery Tracking ─────────────────────────────────────────────
 * Adds delivery/open/reply tracking columns to outreach_queue.
 * Enables real open_rate and reply_rate calculation in the outreach API.
 * ────────────────────────────────────────────────────────────────────────── */

-- Add tracking columns
ALTER TABLE outreach_queue
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_reason text;

-- Index for webhook lookups by external ID (Twilio SID / Resend email ID)
CREATE INDEX IF NOT EXISTS idx_outreach_queue_external_id
  ON outreach_queue (external_id) WHERE external_id IS NOT NULL;

-- Update status check constraint to include new delivery states
-- First drop the old constraint if it exists, then recreate
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'outreach_queue_status_check'
    AND table_name = 'outreach_queue'
  ) THEN
    ALTER TABLE outreach_queue DROP CONSTRAINT outreach_queue_status_check;
  END IF;
END $$;

ALTER TABLE outreach_queue
  ADD CONSTRAINT outreach_queue_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed', 'cancelled'));


-- === 00021_leads_owner_columns.sql ===
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

