-- 00012_prod_hardening.sql
-- Production hardening: auto-profile creation, indexes, constraints

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. profiles: allow users to INSERT their own row
--    (needed for self-registration and OAuth profile creation)
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY profiles_insert_own ON profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. profiles: unique constraint on stripe_customer_id
--    Prevents two profiles sharing a Stripe customer, which would
--    cause billing sync to update the wrong contractor's plan.
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_profiles_stripe_customer'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT uq_profiles_stripe_customer
      UNIQUE (stripe_customer_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. profiles: add role column for homeowner vs contractor routing
--    (migrates any existing rows to 'contractor' as default)
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('contractor', 'homeowner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'contractor';

-- ──────────────────────────────────────────────────────────────
-- 4. leads: compound indexes for dashboard query patterns
-- ──────────────────────────────────────────────────────────────

-- (contractor_id, status) — used in pipeline view with status filter
CREATE INDEX IF NOT EXISTS idx_leads_contractor_status
  ON leads (contractor_id, status);

-- (contractor_id, created_at DESC) — used for recent leads sorting
CREATE INDEX IF NOT EXISTS idx_leads_contractor_created
  ON leads (contractor_id, created_at DESC);

-- (contractor_id, score DESC) — primary dashboard sort
CREATE INDEX IF NOT EXISTS idx_leads_contractor_score
  ON leads (contractor_id, score DESC);

-- ──────────────────────────────────────────────────────────────
-- 5. Auto-create profile on new auth user (fallback trigger)
--    This fires whenever Supabase Auth inserts a new user,
--    covering cases where the HTTP webhook may not fire.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, plan, onboarding_completed)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' = 'homeowner' THEN 'homeowner'::user_role
      ELSE 'contractor'::user_role
    END,
    'free',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger to ensure it's current
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────
-- 6. territories: index for intake → contractor lookup
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_territories_zip_status
  ON territories (zip, status)
  WHERE status = 'active';

COMMIT;
