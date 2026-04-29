-- 00046_referral_credits.sql
-- Idempotent log table for the referral 13th-month-free program
-- (Phase 1.4 of the 2026-04-26 product roadmap).
--
-- Background: migration 00015 already ships the referral SCHEMA —
-- `referral_codes`, `referrals`, `process_referral_signup` RPC, and the
-- `referred_by` column on `profiles`. The signup → tracking → notification
-- chain works today. The missing piece was the PAYMENT-system credit:
-- when the referee's first invoice clears in Stripe, the referrer should
-- get a 1-month-free coupon applied to their next billing cycle ("13th
-- month free").
--
-- This table is the idempotency log so the Stripe webhook
-- (`/api/webhooks/stripe`) doesn't double-credit on retries.
--
-- Schema:
--   - One row per (referrer, referee) pair — UNIQUE constraint enforces this
--   - `stripe_invoice_id` documents the trigger event for audit
--   - `stripe_coupon_id` documents the applied credit
--   - `applied_at` for analytics ("how long from signup to credit")
--
-- RLS: contractors see their own credit history (referrer_id = auth.uid()).
-- Writes are service-role only (the Stripe webhook).

BEGIN;

CREATE TABLE IF NOT EXISTS referral_credits (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id          uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_invoice_id   text        NOT NULL,
  stripe_coupon_id    text,
  applied_at          timestamptz NOT NULL DEFAULT now(),

  -- Idempotency: one credit per (referrer, referee) pair. Stripe webhook
  -- retries against the same referee invoice are silently ignored thanks
  -- to ON CONFLICT DO NOTHING in the webhook handler.
  CONSTRAINT referral_credits_unique_pair UNIQUE (referrer_id, referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_credits_referrer
  ON referral_credits(referrer_id);

CREATE INDEX IF NOT EXISTS idx_referral_credits_applied_at
  ON referral_credits(applied_at DESC);

ALTER TABLE referral_credits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'referral_credits'
      AND policyname = 'referral_credits_self_select'
  ) THEN
    CREATE POLICY referral_credits_self_select ON referral_credits
      FOR SELECT
      TO authenticated
      USING (referrer_id = auth.uid());
  END IF;
END $$;

-- updated_at via moddatetime — pattern from `feedback`, `leads`, etc.
-- per CLAUDE.md "All new DB tables: ... + moddatetime trigger"
ALTER TABLE referral_credits
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_referral_credits'
  ) THEN
    CREATE TRIGGER set_updated_at_referral_credits
      BEFORE UPDATE ON referral_credits
      FOR EACH ROW
      EXECUTE FUNCTION moddatetime(updated_at);
  END IF;
EXCEPTION WHEN undefined_function THEN
  -- moddatetime extension not loaded; skip silently. The trigger is a
  -- nicety, not load-bearing — `applied_at` is the canonical timestamp.
  NULL;
END $$;

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate         (preferred)
--   OR paste into Supabase SQL editor.
--
-- Verify:
--   SELECT 1 FROM referral_credits LIMIT 1;
-- Should return no error.
--
-- Test the integration:
--   1. Apply this migration
--   2. Set up a Stripe test customer who signed up via a referral link
--   3. Simulate `invoice.paid` event in Stripe CLI
--   4. Confirm a row appears in referral_credits
--   5. Confirm referrer's Stripe subscription has a `coupon` attached
