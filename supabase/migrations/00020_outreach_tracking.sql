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
