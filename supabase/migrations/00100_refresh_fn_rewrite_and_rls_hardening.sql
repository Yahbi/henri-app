-- 00100 — refresh_zip_pre_intent_aggregates() rewrite + RLS/security-invoker hardening
--
-- Two independent fixes, bundled because both are small DDL-only changes:
--
-- FIX 1 — the live weekly cron `/api/cron/refresh-zip-aggregates` errors every
--   run with `"zip_pre_intent_aggregates" is not a materialized view`. Migration
--   00093 converted that matview to a REGULAR TABLE (the matview REFRESH timed out
--   at 8s against the Management API), but the refresh function still issued
--   `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Rewrite it to rebuild the table via
--   DELETE + INSERT…SELECT using the exact aggregation from 00093. The function
--   raises its own statement_timeout to 180s (the 8s ceiling is a Management-API
--   constraint only — at runtime the cron handler has the full Vercel budget).
--   This migration only REDEFINES the function (instant); it does NOT run it, so
--   applying this migration does not trip the 8s apply limit.
--
-- FIX 2 — security-advisor ERROR-level findings:
--   * rls_disabled_in_public on score_trade_weights, score_stage_modifiers,
--     zip_pre_intent_aggregates → enable RLS. All three are read only by the
--     score cron via the service_role client (RLS-bypassing), so enabling RLS is
--     non-breaking. A permissive authenticated SELECT policy is added for each
--     (the data is non-sensitive ZIP-level / calibration-default rows) so a future
--     authenticated reader works and the INFO-level rls_enabled_no_policy lint
--     also clears.
--   * security_definer_view on v_permit_adjacent_count, v_permit_storm_proximity →
--     flip to security_invoker. Both views reference only `permits` and
--     `storm_events`, each of which already has a permissive authenticated SELECT
--     policy (verified live), so the contractor-gated drawer query keeps working.
--
-- Idempotent + additive. Safe to re-run.

BEGIN;

-- ── FIX 1: rebuild-the-table refresh function ──────────────────────
CREATE OR REPLACE FUNCTION public.refresh_zip_pre_intent_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- The recompute scans ~1.5M permit rows; the default 8s cap is far too low.
  SET LOCAL statement_timeout = '180s';

  DELETE FROM public.zip_pre_intent_aggregates;

  INSERT INTO public.zip_pre_intent_aggregates
    (zip, adu_90d, remodel_180d, yoy_growth, permits_90d, permits_180d, permits_365d, computed_at)
  WITH base AS (
    SELECT
      zip,
      description,
      COALESCE(issued_date, applied_date, created_at::date) AS effective_date
    FROM public.permits
    WHERE zip IS NOT NULL AND zip <> ''
      AND COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '730 days'
  )
  SELECT
    zip,
    COUNT(*) FILTER (
      WHERE effective_date >= NOW() - INTERVAL '90 days'
        AND description IS NOT NULL
        AND (description ILIKE '%adu%'
          OR description ILIKE '%accessory dwelling%'
          OR description ILIKE '%mother-in-law%'
          OR description ILIKE '%granny flat%'
          OR description ILIKE '%secondary unit%')
    ) AS adu_90d,
    COUNT(*) FILTER (
      WHERE effective_date >= NOW() - INTERVAL '180 days'
        AND description IS NOT NULL
        AND (description ILIKE '%remodel%'
          OR description ILIKE '%renovation%'
          OR description ILIKE '%addition%'
          OR description ILIKE '%kitchen%'
          OR description ILIKE '%bath%'
          OR description ILIKE '%basement%')
        AND description NOT ILIKE '%new construction%'
    ) AS remodel_180d,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE effective_date >= NOW() - INTERVAL '730 days'
          AND effective_date <  NOW() - INTERVAL '365 days'
      ) = 0 THEN NULL
      ELSE (
        COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days')::numeric
        - COUNT(*) FILTER (
            WHERE effective_date >= NOW() - INTERVAL '730 days'
              AND effective_date <  NOW() - INTERVAL '365 days'
          )::numeric
      ) / NULLIF(
        COUNT(*) FILTER (
          WHERE effective_date >= NOW() - INTERVAL '730 days'
            AND effective_date <  NOW() - INTERVAL '365 days'
        )::numeric, 0)
    END AS yoy_growth,
    COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '90 days')  AS permits_90d,
    COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '180 days') AS permits_180d,
    COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days') AS permits_365d,
    NOW() AS computed_at
  FROM base
  GROUP BY zip;
END;
$function$;

-- Supabase grants anon + authenticated EXECUTE on public functions explicitly
-- (not via PUBLIC), so REVOKE … FROM PUBLIC alone leaves them callable. This
-- function does a 180s DELETE+INSERT over ~1.5M permit rows and is exposed at
-- /rest/v1/rpc/refresh_zip_pre_intent_aggregates — leaving it anon-callable is a
-- trivial DoS lever. Lock it to service_role (the cron's client) only.
REVOKE EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() TO service_role;

-- ── FIX 2a: enable RLS + permissive authenticated SELECT on the 3 tables ──
ALTER TABLE public.zip_pre_intent_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_trade_weights       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_stage_modifiers     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zip_pre_intent_aggregates_select_auth ON public.zip_pre_intent_aggregates;
CREATE POLICY zip_pre_intent_aggregates_select_auth
  ON public.zip_pre_intent_aggregates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS score_trade_weights_select_auth ON public.score_trade_weights;
CREATE POLICY score_trade_weights_select_auth
  ON public.score_trade_weights FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS score_stage_modifiers_select_auth ON public.score_stage_modifiers;
CREATE POLICY score_stage_modifiers_select_auth
  ON public.score_stage_modifiers FOR SELECT TO authenticated USING (true);

-- ── FIX 2b: flip the 2 context views to security_invoker ───────────
ALTER VIEW public.v_permit_adjacent_count  SET (security_invoker = true);
ALTER VIEW public.v_permit_storm_proximity SET (security_invoker = true);

COMMIT;
