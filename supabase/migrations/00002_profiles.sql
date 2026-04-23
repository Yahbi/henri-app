-- 00002_profiles.sql
-- Contractor profiles linked to Supabase Auth
-- Includes trade specialization, subscription plan, and Stripe billing IDs

BEGIN;

-- Trade enum
DO $$ BEGIN
  CREATE TYPE trade_type AS ENUM (
    'general', 'roofing', 'plumbing', 'electrical',
    'hvac', 'solar', 'landscaping', 'painting',
    'concrete', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Plan enum
DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM (
    'free', 'starter', 'pro', 'enterprise'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id                     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  text NOT NULL,
  full_name              text,
  company_name           text,
  phone                  text,
  trade                  trade_type NOT NULL DEFAULT 'general',
  plan                   plan_type NOT NULL DEFAULT 'free',
  stripe_customer_id     text,
  stripe_subscription_id text,
  onboarding_completed   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- RLS: users can read and update only their own row
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMIT;
