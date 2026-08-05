-- 00120_repair_objobj_permits.sql
--
-- Batched repair for permits whose address was stringified to the literal
-- text '[object Object]'.
--
-- ─── The damage ─────────────────────────────────────────────────────────
-- The Socrata scraper assigned a `location` OBJECT straight into the text
-- `address` column, so JS stringified it. Measured 2026-08-04:
--   126,754 rows with address = '[object Object]'
--   100%  carry raw_json->'location_1'->'coordinates'
--   99.2% carry address_start / street_* / zip_code
--   0     leads reference them (verified) — no contractor pipeline state
--
-- Because `zip` was also left NULL on these rows, they are invisible to
-- territory matching: they can never become a lead for any contractor.
-- Every field needed to rebuild them is already in raw_json.
--
-- ─── Why a batched FUNCTION and not one UPDATE ──────────────────────────
-- The first attempt ran this as 10k-25k-row UPDATEs through the Supabase
-- Management API. That saturated the connection pool: PostgREST began
-- returning PGRST002 ("could not query the database for the schema cache")
-- and the Management API timed out for ~10 minutes, while the project
-- still reported ACTIVE_HEALTHY. Nothing user-facing broke (the landing
-- page degrades to its honest fallback and no contractor has onboarded),
-- but the whole data layer was unavailable.
--
-- Every PostgREST call inherits the `authenticator` role's 8s
-- statement_timeout. So the repair is exposed as a function that does ONE
-- bounded batch per call and returns how many rows it fixed. The caller
-- loops. Each call is its own statement with its own 8s budget, and the
-- pool is never held.
--
-- ─── Operator runbook ───────────────────────────────────────────────────
--   -- one batch at a time, from the app (service-role client):
--   select public.repair_objobj_permits(2000);   -- returns rows repaired
--   -- repeat until it returns 0, then:
--   drop index if exists public.idx_permits_objobj_repair;
--   -- finally refresh the marketing cache so the new ZIPs are counted:
--   GET /api/cron/refresh-landing-stats
--
-- Start at 2000 and only raise it if calls are returning well under a
-- second. Idempotent: re-running after completion is a no-op.

-- Makes each batch an index scan instead of a seq scan over 2.25M rows.
-- Drop it once the repair is done — it exists only for this migration.
CREATE INDEX IF NOT EXISTS idx_permits_objobj_repair
  ON public.permits (id)
  WHERE address = '[object Object]';

CREATE OR REPLACE FUNCTION public.repair_objobj_permits(p_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  -- Bound the batch so a caller can't accidentally reproduce the outage
  -- this function exists to avoid.
  IF p_batch IS NULL OR p_batch < 1 THEN p_batch := 2000; END IF;
  IF p_batch > 5000 THEN p_batch := 5000; END IF;

  WITH cand AS (
    SELECT id
      FROM public.permits
     WHERE address = '[object Object]'
       AND raw_json ? 'location_1'
     LIMIT p_batch
  ), upd AS (
    UPDATE public.permits p SET
      -- Rebuild "359 W 82ND ST" from the four component fields. NULLIF so
      -- a row with no street parts lands as NULL rather than re-storing a
      -- blank string that would look repaired.
      address = NULLIF(trim(regexp_replace(concat_ws(' ',
                  p.raw_json->>'address_start',
                  p.raw_json->>'street_direction',
                  p.raw_json->>'street_name',
                  p.raw_json->>'street_suffix'), '\s+', ' ', 'g')), ''),
      zip       = COALESCE(p.zip, substring(p.raw_json->>'zip_code' from '\d{5}')),
      -- GeoJSON order is [lng, lat] — not [lat, lng].
      longitude = COALESCE(p.longitude, (p.raw_json->'location_1'->'coordinates'->>0)::numeric),
      latitude  = COALESCE(p.latitude,  (p.raw_json->'location_1'->'coordinates'->>1)::numeric),
      -- Re-queue for scoring: these were stamped scored while carrying a
      -- NULL zip, so they never reached a territory and produced no lead.
      -- Safe ONLY because 0 leads reference these rows — do not copy this
      -- clause into a backfill that touches leads-bearing permits, since
      -- re-scoring would otherwise disturb contractor pipeline state.
      scored_at  = NULL,
      updated_at = now()
    FROM cand
    WHERE p.id = cand.id
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upd;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.repair_objobj_permits(int) IS
  'Repairs one bounded batch of permits whose address stringified to '
  '''[object Object]'', rebuilding address/zip/lat/lng from raw_json. '
  'Returns rows repaired; call in a loop until it returns 0. Batched '
  'deliberately: bulk UPDATEs on this table exhaust the connection pool '
  'and take PostgREST down. See 00120 for the runbook.';

REVOKE EXECUTE ON FUNCTION public.repair_objobj_permits(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repair_objobj_permits(int) TO service_role;
