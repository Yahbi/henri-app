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
