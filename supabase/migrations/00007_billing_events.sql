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

CREATE POLICY billing_events_select_own ON billing_events
  FOR SELECT
  USING (auth.uid() = user_id);

COMMIT;
