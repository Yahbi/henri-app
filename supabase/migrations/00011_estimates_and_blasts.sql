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
