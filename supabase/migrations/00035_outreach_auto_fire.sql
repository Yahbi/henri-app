-- 00035_outreach_auto_fire.sql
--
-- Phase 0a wedge #6 — speed-to-lead auto-fire preference.
--
-- Adds a single jsonb column on `profiles` so a contractor can opt in
-- to auto-firing an outreach template the instant a lead is scored.
-- Scorer reads this column (graceful if missing) and the Outreach tab
-- surfaces a toggle + template-picker for it.
--
-- Shape:
--   { "enabled": false, "template_id": null, "channel": "email" }
--
-- Also adds `twilio_tracked_number` so the missed-call webhook at
-- /api/webhooks/twilio-missed-call can map an inbound call's `To`
-- number back to the right contractor.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS outreach_auto_fire jsonb;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS twilio_tracked_number text;

-- Allow fast lookup by tracked number from the Twilio webhook.
CREATE INDEX IF NOT EXISTS idx_profiles_twilio_tracked_number
  ON profiles (twilio_tracked_number)
  WHERE twilio_tracked_number IS NOT NULL;

COMMIT;
