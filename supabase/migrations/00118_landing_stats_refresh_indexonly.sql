-- 00118_landing_stats_refresh_indexonly.sql
--
-- Rewrite refresh_landing_stats() (00115) to stay on the index-only path.
--
-- The 00115 version wrapped the grouping key in upper()/length():
--
--   SELECT upper(state), count(*) FROM permits
--    WHERE state IS NOT NULL AND length(state) = 2 GROUP BY 1;
--
-- An expression on the grouping key is not indexable, so the planner
-- fell back to a parallel seq scan with an 11 MB external merge sort:
-- 37,514 ms measured. Grouping on the BARE column lets it use
-- idx_permits_state_zip as a parallel index-only scan instead:
-- 9,647 ms with Heap Fetches: 0 (after VACUUM ANALYZE set the
-- visibility map, which was stale and forcing 112k heap fetches per
-- single-state scan).
--
-- Normalisation moves to the outer query, where upper()/length() run
-- over ~50 grouped rows instead of 2.25M raw ones.
--
-- NOTE: 9.6s still exceeds the `authenticator` role's 8s
-- statement_timeout, which every PostgREST call inherits, so this
-- function is NOT callable from a request path. The scheduled refresh
-- at /api/cron/refresh-landing-stats deliberately does NOT call it —
-- it fans the aggregate out into 51 single-state counts (89ms each)
-- that each get their own statement budget. This function remains the
-- operator path, invoked from the Management API or psql where the
-- session timeout is higher.

CREATE OR REPLACE FUNCTION public.refresh_landing_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state_permits jsonb  := '{}'::jsonb;
  v_permits       bigint := 0;
  v_leads         bigint := 0;
  v_zips          bigint := 0;
  v_payload       jsonb;
BEGIN
  -- Inner query groups on the bare column (index-only eligible); the
  -- outer query normalises and drops loader artifacts (state='US',
  -- blanks) which carry no ZIP and can never become leads, so counting
  -- them in the headline would overclaim.
  SELECT COALESCE(jsonb_object_agg(g.st, g.n), '{}'::jsonb),
         COALESCE(SUM(g.n), 0)
    INTO v_state_permits, v_permits
    FROM (
      SELECT upper(t.state) AS st, SUM(t.n)::bigint AS n
        FROM (
          SELECT state, count(*)::bigint AS n
            FROM public.permits
           WHERE state IS NOT NULL
           GROUP BY state
        ) t
       WHERE length(t.state) = 2
         AND upper(t.state) <> 'US'
       GROUP BY upper(t.state)
    ) g;

  SELECT count(DISTINCT zip)::bigint
    INTO v_zips
    FROM public.permits
   WHERE zip IS NOT NULL
     AND length(zip) >= 5;

  SELECT count(*)::bigint INTO v_leads FROM public.leads;

  v_payload := jsonb_build_object(
    'permits_total', v_permits,
    'leads_total',   v_leads,
    'zips_covered',  v_zips,
    'state_permits', v_state_permits,
    'computed_at',   to_char(now() AT TIME ZONE 'utc',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  INSERT INTO public.landing_stats (key, value, updated_at)
  VALUES ('coverage', v_payload, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN v_payload;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_landing_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refresh_landing_stats() TO service_role;
