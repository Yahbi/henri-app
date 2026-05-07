-- Migration 00081: get_active_states_30d() RPC for landing stats
--
-- The marketing landing page powers the "30+ States Covered" badge
-- and the US coverage tile map from `getLandingStats()` in
-- src/lib/stats/landing.ts. The naive client-side approach (scan all
-- recent permits, dedupe state codes in JS) under-counts because
-- California alone has ~521k permits in any 30-day window — a 50k
-- row limit never reaches other states.
--
-- This RPC pushes the DISTINCT down to Postgres so the call returns
-- ~35 rows instead of streaming 50k. Cheap, deterministic, idempotent.
-- Granted to authenticated, service_role, and anon (it's already
-- public information — same data the marketing landing page renders
-- to anonymous visitors).
--
-- Applied 2026-05-07 via the Supabase Management API. This file
-- documents the schema for future re-applies / fresh environments.

CREATE OR REPLACE FUNCTION public.get_active_states_30d()
RETURNS TABLE (state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT UPPER(p.state)::text
  FROM public.permits p
  WHERE p.created_at > NOW() - INTERVAL '30 days'
    AND p.state IS NOT NULL
    AND p.state != ''
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_states_30d() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_states_30d()
  TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.get_active_states_30d() IS
  'Distinct US states with at least one new permit in the last 30 days. Powers the live coverage map and the "30+ states covered" headline on the marketing landing page.';
