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

CREATE POLICY intakes_select_matched ON homeowner_intakes
  FOR SELECT
  USING (auth.uid() = matched_contractor_id);

-- Allow anonymous inserts (from portal)
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

CREATE POLICY outreach_select_own ON outreach_logs
  FOR SELECT USING (auth.uid() = contractor_id);

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

CREATE POLICY estimates_select_own ON estimates
  FOR SELECT USING (auth.uid() = contractor_id);

CREATE POLICY estimates_insert_own ON estimates
  FOR INSERT WITH CHECK (auth.uid() = contractor_id);

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
