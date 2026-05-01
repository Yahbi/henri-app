-- 00068_profile_tutorial_state.sql
-- Adds the tutorial-completion timestamp to profiles for the
-- contractor first-run guided tour. NULL = the contractor hasn't
-- completed (or skipped) the tour; non-null = tour ended at that
-- timestamp (whether by Finish, Skip, or Close — all dismiss the
-- same way). The Replay-tutorial button in /dashboard/settings
-- POSTs DELETE /api/profile/tutorial which sets it back to NULL.
--
-- Idempotent + additive — safe to re-run, won't break existing
-- profile rows. Already applied to the live DB via Supabase MCP on
-- 2026-04-30; this file is the source-of-truth copy that lives in
-- git so re-creating the schema from scratch reproduces the column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tutorial_completed_at timestamptz;

-- Useful for cohort queries ("how many contractors finished the
-- tour"). The single-row read inside useUser doesn't need it, but
-- it's cheap insurance.
CREATE INDEX IF NOT EXISTS idx_profiles_tutorial_completed_at
  ON public.profiles (tutorial_completed_at)
  WHERE tutorial_completed_at IS NOT NULL;
