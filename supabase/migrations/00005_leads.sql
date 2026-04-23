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

CREATE POLICY leads_select_own ON leads
  FOR SELECT
  USING (auth.uid() = contractor_id);

CREATE POLICY leads_update_own ON leads
  FOR UPDATE
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

COMMIT;
