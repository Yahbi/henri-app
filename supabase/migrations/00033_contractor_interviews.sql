-- 00033_contractor_interviews.sql
--
-- Phase 0a validation-interview mini-CRM. 15-20 contractor calls before
-- we build more. Each row logs the conversation: who, what trade, what
-- ranked complaints emerged, what they said about their last 3 leads,
-- and any free-form notes.
--
-- Why in-app vs a spreadsheet: so the interview log lives next to the
-- product it validates. When we iterate on Phase 0b, we open the
-- Settings → Interviews tab, read the raw quotes, and re-weight the
-- wedge priorities against what contractors actually said.

BEGIN;

CREATE TABLE IF NOT EXISTS contractor_interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contractor_name    text NOT NULL,
  contractor_company text,
  trade              text,
  state              varchar(2),
  years_in_business  integer,
  crew_size          integer,
  -- Top-3 pain-point rankings (from the 10-item list in CLAUDE.md wedge).
  -- Free-form in jsonb so we can change the taxonomy without migrations.
  ranked_complaints  jsonb,  -- e.g. [{rank:1,pain:"shared_leads",verbatim:"..."},...]
  -- Their last 3 leads' outcomes.
  last_3_leads       jsonb,  -- e.g. [{source:"angi",cost:125,outcome:"not_reached"},...]
  notes              text,
  interviewed_at     timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interviews_author_time
  ON contractor_interviews (author_id, interviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_trade
  ON contractor_interviews (trade);

CREATE OR REPLACE TRIGGER contractor_interviews_updated_at
  BEFORE UPDATE ON contractor_interviews
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE contractor_interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY interviews_select_own ON contractor_interviews
  FOR SELECT
  TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY interviews_insert_own ON contractor_interviews
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY interviews_update_own ON contractor_interviews
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY interviews_delete_own ON contractor_interviews
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

COMMIT;
