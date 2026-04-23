-- 00015_referrals.sql
-- Referral system: codes, tracking, credit issuance

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. referral_codes — one per contractor, auto-generated
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_referral_code       UNIQUE (code),
  CONSTRAINT uq_referral_contractor UNIQUE (contractor_id)
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY referral_codes_select ON referral_codes
    FOR SELECT TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referral_codes_insert ON referral_codes
    FOR INSERT TO authenticated
    WITH CHECK (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. referrals — tracks each referral event
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE referral_type   AS ENUM ('contractor', 'homeowner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('invited', 'signed_up', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_email  text NOT NULL,
  referred_name   text,
  referred_user_id uuid REFERENCES profiles(id),
  type            referral_type NOT NULL DEFAULT 'contractor',
  status          referral_status NOT NULL DEFAULT 'invited',
  reward_amount   numeric(10,2),
  reward_label    text,
  reward_issued   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  converted_at    timestamptz,

  CONSTRAINT uq_referral_pair UNIQUE (referrer_id, referred_email)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_email    ON referrals(referred_email);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY referrals_select ON referrals
    FOR SELECT TO authenticated
    USING (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referrals_insert ON referrals
    FOR INSERT TO authenticated
    WITH CHECK (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY referrals_update ON referrals
    FOR UPDATE TO authenticated
    USING (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. Add referral_code column to profiles for signup tracking
-- ──────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by text;

-- ──────────────────────────────────────────────────────────────
-- 4. RPC: get_or_create_referral_code
--    Returns the contractor's referral code, creating it if needed
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_or_create_referral_code(p_contractor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code
    FROM referral_codes
   WHERE contractor_id = p_contractor_id;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  v_code := 'HENRI-' || upper(substr(p_contractor_id::text, 1, 6));

  INSERT INTO referral_codes (contractor_id, code)
  VALUES (p_contractor_id, v_code)
  ON CONFLICT (contractor_id) DO NOTHING;

  SELECT code INTO v_code
    FROM referral_codes
   WHERE contractor_id = p_contractor_id;

  RETURN v_code;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. RPC: process_referral_signup
--    Called when a new user signs up with a referral code
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_referral_signup(
  p_referral_code text,
  p_new_user_id uuid,
  p_new_user_email text,
  p_new_user_role text DEFAULT 'contractor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_ref_type referral_type;
  v_reward_amount numeric(10,2);
  v_reward_label text;
BEGIN
  -- Look up referral code owner
  SELECT contractor_id INTO v_referrer_id
    FROM referral_codes
   WHERE code = p_referral_code;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  -- Determine reward based on role
  IF p_new_user_role = 'contractor' THEN
    v_ref_type := 'contractor';
    v_reward_label := '1 month free';
    v_reward_amount := 0; -- Credit applied via Stripe
  ELSE
    v_ref_type := 'homeowner';
    v_reward_label := '$50 credit';
    v_reward_amount := 50.00;
  END IF;

  -- Upsert referral record
  INSERT INTO referrals (referrer_id, referred_email, referred_user_id, type, status, reward_label, reward_amount)
  VALUES (v_referrer_id, p_new_user_email, p_new_user_id, v_ref_type, 'signed_up', v_reward_label, v_reward_amount)
  ON CONFLICT (referrer_id, referred_email)
  DO UPDATE SET
    referred_user_id = EXCLUDED.referred_user_id,
    status = 'signed_up',
    reward_label = EXCLUDED.reward_label,
    reward_amount = EXCLUDED.reward_amount;

  -- Mark the new user's profile with the referral code
  UPDATE profiles SET referred_by = p_referral_code WHERE id = p_new_user_id;

  -- Notify the referrer
  INSERT INTO notifications (user_id, type, title, body, read)
  VALUES (
    v_referrer_id,
    'referral',
    'Your referral signed up',
    p_new_user_email || ' just signed up using your referral link.',
    false
  );

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'type', v_ref_type::text,
    'reward_label', v_reward_label
  );
END;
$$;

COMMIT;
