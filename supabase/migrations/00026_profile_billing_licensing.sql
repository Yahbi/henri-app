-- ────────────────────────────────────────────────────────────────────────
-- 00026: Profile billing + licensing columns
--
-- Adds columns that are already written by shipped code paths:
--   - src/app/api/webhooks/stripe/route.ts      (trial_ends_at)
--   - src/components/layout/DashboardTopBar.tsx (trial_ends_at, licensed_until)
--   - src/app/api/licenses/verify/route.ts      (licensed_until, license_state,
--                                               license_number, last_license_verified_at)
--   - src/app/api/billing/change-plan/route.ts  (pending_plan, pending_plan_effective_at)
--
-- Without these, the corresponding endpoints raise 500s on first write. This
-- migration is a pure additive ALTER — no data re-shaping, no drops.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS licensed_until date,
  ADD COLUMN IF NOT EXISTS license_state text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS last_license_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_plan text,
  ADD COLUMN IF NOT EXISTS pending_plan_effective_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_compliance_check_at timestamptz;

-- Lightweight index so the daily license-verify cron can efficiently
-- find profiles whose license is about to expire (license_active=false
-- when licensed_until < now() — composed at query time). Partial index
-- skips the majority of rows that are either not-yet-licensed or have
-- far-future expiry.
CREATE INDEX IF NOT EXISTS idx_profiles_licensed_until
  ON public.profiles (licensed_until)
  WHERE licensed_until IS NOT NULL;

-- Pending-plan index — used by a future cron that flips `plan` to
-- `pending_plan` once `pending_plan_effective_at` passes.
CREATE INDEX IF NOT EXISTS idx_profiles_pending_plan_effective
  ON public.profiles (pending_plan_effective_at)
  WHERE pending_plan IS NOT NULL;
