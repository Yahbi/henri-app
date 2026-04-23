-- ===========================================================================
-- Phase 1 (homeowner transparency pack) - manual DDL handoff.
-- Paste into https://supabase.com/dashboard/project/ivfxylgoxgrxttknewsf/sql/new
-- and click RUN. Idempotent - safe to re-run.
--
-- Supports these new endpoints shipped in Phase 1.6:
--   /api/homeowner/property           (GET, PATCH)
--   /api/homeowner/maintenance        (GET, POST)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. homeowner_properties - one row per homeowner; stored home value,
--    mortgage balance, year built, square footage. Replaces the hard-coded
--    $580k / $340k demo values in PropertyTracker.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.homeowner_properties (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  zip text,
  home_value numeric(12,2),
  mortgage numeric(12,2),
  year_built integer,
  home_sqft integer,
  lot_sqft integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.homeowner_properties ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='homeowner_properties'
       AND policyname='homeowner_properties_own_all'
  ) THEN
    CREATE POLICY "homeowner_properties_own_all"
      ON public.homeowner_properties
      FOR ALL
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. homeowner_maintenance_completed - record of which MaintenanceCalendar
--    tasks a homeowner has ticked off. Composite key (owner_id, task_id)
--    makes "toggle" idempotent via upsert.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.homeowner_maintenance_completed (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, task_id)
);

ALTER TABLE public.homeowner_maintenance_completed ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='homeowner_maintenance_completed'
       AND policyname='homeowner_maintenance_own_all'
  ) THEN
    CREATE POLICY "homeowner_maintenance_own_all"
      ON public.homeowner_maintenance_completed
      FOR ALL
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 3. profiles.years_experience - used by the matching engine (Phase 1.3)
--    so the intake API exposes real years-of-experience instead of the
--    hard-coded "15 yrs" placeholder. Idempotent add.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS years_experience integer;

-- ---------------------------------------------------------------------------
-- 4. leads.job_stage - post-win delivery stage. Replaces the JSON-in-notes
--    hack in /dashboard/jobs ({"job_stage":"scheduled", ...} prefix on
--    notes). Safer + queryable + survives a notes overwrite by a contractor.
--    Only meaningful when status='won'; null everywhere else.
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS job_stage text
    CHECK (job_stage IN ('scheduled','in_progress','punch_list','complete','invoiced'));

CREATE INDEX IF NOT EXISTS idx_leads_contractor_job_stage
  ON public.leads (contractor_id, job_stage)
  WHERE job_stage IS NOT NULL;

-- ===========================================================================
-- Verify after running:
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('homeowner_properties','homeowner_maintenance_completed');
--   -- should return 2 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles' AND column_name='years_experience';
--   -- should return 1 row
-- ===========================================================================
