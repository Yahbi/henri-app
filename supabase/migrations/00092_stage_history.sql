-- 00092_stage_history.sql
--
-- Module 7 of the Phase Z sprint (plan §Z.15.7).
--
-- Today we re-stamp `leads.opportunity_stage` in place every time the
-- score cron runs. There's no history of how a lead moved through
-- stages, so we can't answer questions like "this lead has been in
-- active_intent for 12 days" or "the average lead spends 5 days at
-- permit_filed_no_contractor before being claimed."
--
-- This migration adds:
--   1. `stage_history` table (lead_id, from_stage, to_stage, changed_at,
--      changed_by_kind)
--   2. Trigger on `leads` UPDATE that INSERTs a row when
--      opportunity_stage changes (including the initial NULL → first stage
--      transition).
--   3. Trigger on `leads` INSERT that records the initial stage stamp.
--
-- The downstream `IntentChip` component reads the latest stage_history
-- row to surface "Hot for X days" duration on the lead-card / drawer.
--
-- Idempotent + additive.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  /* Source of the stage change. Allowed values (validated in code):
   *   'score_cron'  — periodic re-classification by /api/cron/score
   *   'backfill'    — one-shot backfill script
   *   'manual'      — contractor explicitly bumped a stage in the UI
   *   'intake'      — homeowner intake submission
   *   'system'      — fallback / unknown */
  changed_by_kind text NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS stage_history_lead_idx
  ON public.stage_history (lead_id, changed_at DESC);

ALTER TABLE public.stage_history ENABLE ROW LEVEL SECURITY;

-- Read access: a contractor reads stage_history rows for the leads
-- they own. Joining `leads.contractor_id = auth.uid()`.
DO $$ BEGIN
  CREATE POLICY stage_history_self_select ON public.stage_history
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = stage_history.lead_id
          AND l.contractor_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writes: service-role-only (cron + backfill use admin client).

-- Trigger function: detects opportunity_stage changes on leads and
-- inserts a stage_history row. Handles INSERT (initial stage) and
-- UPDATE (transition).
CREATE OR REPLACE FUNCTION public.record_stage_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only record an initial-stamp row if the row landed with a
    -- non-null stage. Pre-classifier rows (NULL stage) are not
    -- meaningful as "transitions."
    IF NEW.opportunity_stage IS NOT NULL THEN
      INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_by_kind)
      VALUES (NEW.id, NULL, NEW.opportunity_stage, COALESCE(NEW.score_model, 'system'));
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE — only insert if opportunity_stage actually changed.
  -- IS DISTINCT FROM correctly handles NULL → value transitions.
  IF NEW.opportunity_stage IS DISTINCT FROM OLD.opportunity_stage THEN
    INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_by_kind)
    VALUES (NEW.id, OLD.opportunity_stage, NEW.opportunity_stage, COALESCE(NEW.score_model, 'system'));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_stage_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS leads_stage_history_insert ON public.leads;
CREATE TRIGGER leads_stage_history_insert
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.record_stage_history();

DROP TRIGGER IF EXISTS leads_stage_history_update ON public.leads;
CREATE TRIGGER leads_stage_history_update
  AFTER UPDATE OF opportunity_stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.record_stage_history();

COMMIT;

-- Verify:
--   SELECT lead_id, from_stage, to_stage, changed_at
--   FROM public.stage_history
--   ORDER BY changed_at DESC
--   LIMIT 10;
