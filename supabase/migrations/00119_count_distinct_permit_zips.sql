-- 00119_count_distinct_permit_zips.sql
--
-- Distinct-ZIP count for the landing coverage cache.
--
-- PostgREST cannot express COUNT(DISTINCT col), so the refresh cron at
-- /api/cron/refresh-landing-stats needs a callable helper for the
-- "N ZIP codes covered" stat on the homepage.
--
-- Kept as its own function rather than folded into
-- refresh_landing_stats() so that each piece of the refresh is a
-- SEPARATE statement. Statement_timeout is armed per statement, and
-- every PostgREST call inherits the `authenticator` role's 8s limit —
-- one combined function would blow that budget, whereas this alone
-- measures 3.6s as an index-only scan on idx_permits_zip
-- (Heap Fetches: 0 after VACUUM).

CREATE OR REPLACE FUNCTION public.count_distinct_permit_zips()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(DISTINCT zip)::bigint
    FROM public.permits
   WHERE zip IS NOT NULL
     AND length(zip) >= 5;
$$;

REVOKE EXECUTE ON FUNCTION public.count_distinct_permit_zips() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.count_distinct_permit_zips() TO service_role;
