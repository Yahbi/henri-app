-- 00141_repair_house_number_zips_v2.sql
-- 2026-08-07 — null out ZIPs that are actually the address's house number.
--
-- ─── The damage ─────────────────────────────────────────────────────────
-- 139,317 permits and 67,394 leads store a `zip` that is byte-identical to
-- the leading house number of their own address:
--
--     address "15310 W SUNSET BLVD"  state CA  zip "15310"
--
-- They are five digits, so every `/^\d{5}$/` validator in the codebase passes
-- them, and they look like ordinary data everywhere. 48,333 of the leads are
-- in California carrying ZIPs between 10000 and 28158; California's real
-- range is 90001-96162.
--
-- ─── Why it matters ─────────────────────────────────────────────────────
-- ZIP is the ONLY key territory matching uses. A permit with a fabricated ZIP
-- is either invisible to the contractor who actually covers that address, or
-- -- worse -- delivered to a contractor a thousand miles away who is paying
-- for exclusivity in the ZIP it collided with.
--
-- Blast radius TODAY is 2 leads, because only 10 territories are claimed and
-- the collisions mostly land in unclaimed ZIPs. That is luck, not safety: the
-- damage scales directly with territories sold, so this is cheap to fix now
-- and expensive to fix after launch.
--
-- ─── Why NULL rather than a corrected value ─────────────────────────────
-- There is nothing to correct it TO. The house number carries no information
-- about the postal code, so any derived value would be invented. NULL is the
-- honest state, and it is also the useful one: /api/cron/census-geocode
-- selects on `zip IS NULL` and will resolve the real ZIP from the address at
-- a measured 58% match rate. A wrong ZIP is worse than a missing one --
-- missing is recoverable and visibly incomplete, wrong is silently confident.
--
-- Note 00124 already attempted this class of repair. It did not cover these
-- rows: this predicate compares zip against the address's own leading digits,
-- which catches the case regardless of state or ZIP range.
--
-- ─── Why a batched FUNCTION and not one UPDATE ──────────────────────────
-- Bulk DML through the Management API took this database down on 2026-08-04:
-- the connection pool saturated, PostgREST returned PGRST002, and the whole
-- data layer was unavailable for ~10 minutes while the project still reported
-- ACTIVE_HEALTHY. Every PostgREST call also inherits a statement_timeout.
--
-- So the repair is one bounded batch per call, returning how many rows it
-- fixed; the caller loops WITH PACING (bounded statements alone still
-- saturate a pool when fired back to back -- see
-- scripts/run-objobj-repair.mjs, which is the proven shape).
--
-- Idempotent and resumable: each call re-selects its own next batch, so
-- re-running after any interruption continues rather than repeating.

BEGIN;

-- Makes each batch index-scannable instead of seq-scanning 4.1M permits.
-- Dropped once the backlog is drained (see the runbook note at the bottom).
CREATE INDEX IF NOT EXISTS idx_permits_housenum_zip_repair
  ON public.permits (id)
  WHERE zip IS NOT NULL
    AND address IS NOT NULL;

CREATE OR REPLACE FUNCTION public.repair_house_number_zips(p_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_fixed int;
BEGIN
  WITH cand AS (
    SELECT id
      FROM public.permits
     WHERE zip IS NOT NULL
       AND address IS NOT NULL
       -- zip is exactly the address's own leading house number
       AND zip = substring(address from '^([0-9]+)')
     LIMIT p_batch
  )
  UPDATE public.permits p
     SET zip = NULL
    FROM cand
   WHERE p.id = cand.id;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RETURN v_fixed;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.repair_house_number_zips(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.repair_house_number_zips(int) TO service_role;

-- Same repair for `leads`. Kept separate because a lead carries contractor
-- state (notes, status) that must not be touched, and because a lead whose
-- ZIP is nulled must also lose its territory assignment -- it is no longer
-- provably inside anyone's territory. The score cron re-assigns it once
-- census-geocode resolves the real ZIP.
CREATE OR REPLACE FUNCTION public.repair_house_number_zips_leads(p_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_fixed int;
BEGIN
  WITH cand AS (
    SELECT id
      FROM public.leads
     WHERE zip IS NOT NULL
       AND address IS NOT NULL
       AND zip = substring(address from '^([0-9]+)')
     LIMIT p_batch
  )
  UPDATE public.leads l
     SET zip = NULL,
         contractor_id = NULL
    FROM cand
   WHERE l.id = cand.id;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RETURN v_fixed;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.repair_house_number_zips_leads(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.repair_house_number_zips_leads(int) TO service_role;

COMMIT;

-- ─── Runbook ────────────────────────────────────────────────────────────
--   node scripts/run-zip-repair.mjs            (paced, resumable)
-- Afterwards, once both counts read 0:
--   DROP INDEX IF EXISTS public.idx_permits_housenum_zip_repair;
-- The nulled rows re-enter /api/cron/census-geocode automatically.
--
-- ─── Rollback ───────────────────────────────────────────────────────────
-- There is none, and that is deliberate: the discarded values were fabricated
-- and carried no recoverable information. Restoring them would restore the
-- bug.
--   DROP FUNCTION IF EXISTS public.repair_house_number_zips(int);
--   DROP FUNCTION IF EXISTS public.repair_house_number_zips_leads(int);
