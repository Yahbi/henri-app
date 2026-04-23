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
CREATE POLICY "Contractors see own matches" ON intake_matches
  FOR SELECT USING (contractor_id = auth.uid());

-- Homeowners can see matches for their intakes
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
