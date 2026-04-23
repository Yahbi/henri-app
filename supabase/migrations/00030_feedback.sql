-- 00030_feedback.sql
--
-- In-app feedback from contractors and homeowners. One row per
-- submission — no threading, no triage state machine. The goal is
-- cheap to capture, cheap to read, easy to act on.
--
-- Surfaced in the UI via a "Send feedback" button in the contractor
-- DashboardTopBar and the homeowner portal nav. Both roles post to
-- /api/feedback, which inserts here.

BEGIN;

DO $$ BEGIN
  CREATE TYPE feedback_category AS ENUM (
    'bug',            -- Something is broken
    'feature_request',-- I want X
    'praise',         -- I like X
    'complaint',      -- I don't like X (softer than bug)
    'question',       -- How do I …
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE feedback_status AS ENUM (
    'new',       -- Just landed, unreviewed
    'triaged',   -- Read + categorized by ops
    'in_progress',
    'resolved',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who sent it. `user_id` is null for anonymous submissions (logged-out
  -- homeowners filling the portal before signup). Role snapshot so we
  -- can still split the inbox when the profiles row is later deleted.
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role          text NOT NULL CHECK (role IN ('contractor', 'homeowner', 'anonymous')),
  email         text, -- Filled for anonymous submissions so we can reply
  -- What they said
  category      feedback_category NOT NULL DEFAULT 'other',
  rating        smallint CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  message       text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  -- Context for faster triage
  page_path     text,  -- Route they were on when they opened the dialog
  user_agent    text,  -- Browser/OS; helps reproduce bug reports
  app_version   text,  -- Git SHA if wired
  -- Ops state
  status        feedback_status NOT NULL DEFAULT 'new',
  admin_notes   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user      ON feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status    ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category  ON feedback (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_role_time ON feedback (role, created_at DESC);

-- Trigger: bump updated_at when ops edits the row (notes / status).
CREATE OR REPLACE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: users can INSERT their own, SELECT their own history. Ops
-- reads via service-role key (bypasses RLS). No UPDATE/DELETE from
-- client — triage happens in the admin dashboard.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_insert_self ON feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feedback_select_self ON feedback
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Anonymous submissions (homeowners pre-signup). The INSERT path goes
-- through the API route with the service-role key, so no anon policy
-- needed — the endpoint enforces its own checks (message length,
-- rate-limit) and stores role='anonymous'.

COMMIT;
