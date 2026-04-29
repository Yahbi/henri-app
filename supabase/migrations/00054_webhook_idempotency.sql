-- 00054_webhook_idempotency.sql
--
-- Adds a generic webhook idempotency log so providers like Twilio and
-- Resend can dedupe replayed events the same way Stripe already does
-- (see migration 00007's `billing_events` + the unique constraint on
-- `stripe_event_id`).
--
-- Why a separate table instead of extending billing_events:
--   billing_events is Stripe-specific (carries plan, amount_cents,
--   subscription_id metadata). Webhook idempotency for SMS / email is
--   simpler — we just need to know "have we processed this event ID
--   before". One narrow table beats overloading billing_events with
--   nullable provider-specific columns.
--
-- Schema:
--   provider      text   — "twilio" | "resend" | "stripe" (future)
--   event_id      text   — Twilio MessageSid, Resend svix-id, etc.
--   processed_at  timestamptz NOT NULL DEFAULT now()
--
-- Composite primary key (provider, event_id) gives O(1) lookups for
-- "has this event been seen?" via PostgREST `select.eq().eq()`.
--
-- Idempotent. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS webhook_idempotency (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  -- Audit aid: the kind of payload (e.g. Twilio "message.delivered",
  -- Resend "email.bounce"). Optional; not part of the key.
  event_type   text,
  -- One-pass JSON of the relevant request fields, for forensic review
  -- when an event ID looks suspicious. Capped at ~2KB by the importer.
  raw_meta     jsonb,
  PRIMARY KEY (provider, event_id)
);

-- Cron-friendly: prune events older than 90 days. Index supports the
-- range delete without scanning the full table.
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_processed_at
  ON webhook_idempotency (processed_at);

-- RLS: service role writes; authenticated reads (transparent operations
-- aid, never sensitive — webhook IDs are vendor-issued opaque tokens).
ALTER TABLE webhook_idempotency ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'webhook_idempotency'
      AND policyname = 'webhook_idempotency_select_authenticated'
  ) THEN
    CREATE POLICY webhook_idempotency_select_authenticated
      ON webhook_idempotency
      FOR SELECT TO authenticated USING (true);
  END IF;
END$$;

COMMENT ON TABLE webhook_idempotency IS
  'Tracks processed webhook events by (provider, event_id) to dedupe replays. Mirror of Stripe billing_events.stripe_event_id approach but generic across providers.';
COMMENT ON COLUMN webhook_idempotency.provider IS
  'Vendor name. Examples: twilio, resend. Stripe stays in billing_events for backward-compat.';
COMMENT ON COLUMN webhook_idempotency.event_id IS
  'Provider-issued event ID. Twilio: MessageSid. Resend: svix-id header.';

COMMIT;
