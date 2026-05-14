-- 00093_zip_pre_intent_aggregates.sql
--
-- Phase AA-3 — closes the Z.2 classifier-input gap. The 50 reason codes
-- starved by missing ZIP-aggregate signals get unblocked: the
-- materialised view caches the per-ZIP counts that previously timed out
-- the Management API every time the classifier asked for them inline.
--
-- Reason codes lit immediately after the view is populated:
--   • `nearby_adu_activity_90d`     — ≥3 ADU permits in same ZIP, last 90d
--   • `nearby_remodel_activity_90d` — ≥5 remodel permits in same ZIP, last 180d
--   • `neighborhood_upgrade_trend`  — YoY permit volume growth in same ZIP
--
-- Architectural note: the initial CREATE MATERIALIZED VIEW must finish
-- under the Management API's 8s statement timeout, OR be created WITH
-- NO DATA and populated separately. We do the latter:
--   1. CREATE MATERIALIZED VIEW … WITH NO DATA  (instant — definition only)
--   2. Unique index for CONCURRENTLY refresh
--   3. RLS grants
--   4. Refresh helper function
-- The view is then populated via the companion script
-- `scripts/_refresh-zip-aggregates.mjs` which runs the REFRESH outside
-- the Management API path (using a longer-tolerant client) — see that
-- script for the population strategy.
--
-- Scoping: the view only aggregates permits with effective_date in the
-- last 730 days. Older permits are irrelevant for the 90d/180d/365d
-- windows the classifier uses, and excluding them cuts the working set
-- from ~1.4M to ~400k rows so the eventual REFRESH fits a reasonable
-- budget.
--
-- Idempotent.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.zip_pre_intent_aggregates;

CREATE MATERIALIZED VIEW public.zip_pre_intent_aggregates AS
WITH base AS (
  SELECT
    zip,
    description,
    COALESCE(issued_date, applied_date, created_at::date) AS effective_date
  FROM public.permits
  WHERE zip IS NOT NULL
    AND zip <> ''
    -- Scope to the only window the classifier actually queries (max
    -- 730d — YoY computation needs the prior-year baseline).
    AND COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '730 days'
)
SELECT
  zip,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '90 days'
      AND description IS NOT NULL
      AND (
        description ILIKE '%adu%'
        OR description ILIKE '%accessory dwelling%'
        OR description ILIKE '%mother-in-law%'
        OR description ILIKE '%granny flat%'
        OR description ILIKE '%secondary unit%'
      )
  ) AS adu_90d,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '180 days'
      AND description IS NOT NULL
      AND (
        description ILIKE '%remodel%'
        OR description ILIKE '%renovation%'
        OR description ILIKE '%addition%'
        OR description ILIKE '%kitchen%'
        OR description ILIKE '%bath%'
        OR description ILIKE '%basement%'
      )
      AND description NOT ILIKE '%new construction%'
  ) AS remodel_180d,
  CASE
    WHEN COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days') = 0
      THEN NULL
    ELSE (
      COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days')::numeric
      - COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric
    ) / NULLIF(COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric, 0)
  END AS yoy_growth,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '90 days')  AS permits_90d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '180 days') AS permits_180d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days') AS permits_365d,
  NOW() AS computed_at
FROM base
GROUP BY zip
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS zip_pre_intent_aggregates_zip_idx
  ON public.zip_pre_intent_aggregates (zip);

REVOKE ALL ON public.zip_pre_intent_aggregates FROM PUBLIC;
GRANT SELECT ON public.zip_pre_intent_aggregates TO authenticated;
GRANT SELECT ON public.zip_pre_intent_aggregates TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_zip_pre_intent_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zip_pre_intent_aggregates;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() TO service_role;

COMMIT;
