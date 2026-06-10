-- 00101 — refresh_zip_pre_intent_aggregates(): satisfy pg-safeupdate guard
--
-- Migration 00100 rewrote this function to rebuild the table via an UNQUALIFIED
-- `DELETE FROM public.zip_pre_intent_aggregates;`. That works when the function
-- is run as the `postgres` role (e.g. the Management API), but FAILS at runtime
-- when invoked through PostgREST / supabase-js `.rpc()` — i.e. exactly the path
-- the weekly cron `/api/cron/refresh-zip-aggregates` uses.
--
-- Root cause: Supabase enables the pg-safeupdate guard (`safeupdate.enabled = on`)
-- for the API connection. That GUC is session-level and is therefore still in
-- effect INSIDE this SECURITY DEFINER function (the definer-role switch does not
-- clear a session GUC). pg-safeupdate rejects any DELETE/UPDATE without a WHERE
-- clause with: `ERROR: DELETE requires a WHERE clause`. Result: the cron has
-- errored on every run since 00100 shipped and never refreshed the aggregates.
--
-- Fix: add an explicit `WHERE true`. pg-safeupdate is satisfied by the presence
-- of any WHERE clause; `WHERE true` preserves the exact delete-all semantics and
-- is a no-op for the postgres-role path. Everything else in 00100 is unchanged.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_zip_pre_intent_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- The recompute scans ~1.5M permit rows; the default 8s cap is far too low.
  SET LOCAL statement_timeout = '180s';

  -- `WHERE true` satisfies pg-safeupdate (the API session sets safeupdate.enabled=on);
  -- semantics are identical to an unqualified delete-all.
  DELETE FROM public.zip_pre_intent_aggregates WHERE true;

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

REVOKE EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() TO service_role;

COMMIT;
