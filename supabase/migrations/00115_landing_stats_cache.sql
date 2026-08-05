-- 00115_landing_stats_cache.sql
--
-- Landing-page coverage cache.
--
-- WHY THIS EXISTS
-- The marketing map ("how much coverage do we have") needs a per-state
-- permit histogram. Measured on live data 2026-08-04:
--
--   EXPLAIN ANALYZE
--     SELECT upper(state), count(*) FROM permits
--      WHERE state IS NOT NULL AND length(state) = 2 GROUP BY 1;
--   -> Parallel Seq Scan + external merge sort (11 MB to disk)
--   -> Execution Time: 37,514 ms
--
-- PostgREST's `authenticator` role has an 8s statement_timeout, so that
-- query can never be served from a request path. That is why the covered-
-- states list in src/lib/stats/landing.ts was a hand-curated array frozen
-- on 2026-05-07 (25 states) while the database had grown to 46 — the map
-- was structurally unable to tell the truth.
--
-- The fix is the one already sketched as a TODO in landing.ts: compute the
-- aggregate out-of-band, store one row, read it in ~1 ms.
--
-- Additive + idempotent. Nothing reads this table until the app is
-- deployed, and the app falls back to its existing count path when the
-- row is missing, so this migration is safe to apply ahead of the code.

CREATE TABLE IF NOT EXISTS public.landing_stats (
  key        text PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.landing_stats IS
  'Out-of-band cache for marketing-page coverage numbers. One row per key; '
  'refreshed by refresh_landing_stats(). Read path must graceful-degrade '
  'when a key is absent.';

ALTER TABLE public.landing_stats ENABLE ROW LEVEL SECURITY;

-- These numbers are rendered on the public homepage, so anon SELECT leaks
-- nothing that isn't already visible to any visitor. Writes stay
-- service-role only (no INSERT/UPDATE/DELETE policy exists).
DO $$ BEGIN
  CREATE POLICY landing_stats_public_read
    ON public.landing_stats
    FOR SELECT
    TO anon, authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Recomputes the coverage payload. Intentionally expensive (~40-90s of
-- sequential scan) — call it from a cron or the Management API, never from
-- a request path.
--
-- statement_timeout is raised locally because the default for the calling
-- role would kill the GROUP BY partway through and leave the cache stale
-- with no error surfaced to an operator.
CREATE OR REPLACE FUNCTION public.refresh_landing_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  v_state_permits jsonb  := '{}'::jsonb;
  v_permits       bigint := 0;
  v_leads         bigint := 0;
  v_zips          bigint := 0;
  v_payload       jsonb;
BEGIN
  -- Per-state histogram. `state = 'US'` and blank/NULL states are loader
  -- artifacts with no ZIP — they can never become leads, so counting them
  -- in the headline would overclaim (see the junk-row subtraction already
  -- documented in src/lib/stats/landing.ts).
  SELECT COALESCE(jsonb_object_agg(t.st, t.n), '{}'::jsonb),
         COALESCE(SUM(t.n), 0)
    INTO v_state_permits, v_permits
    FROM (
      SELECT upper(state) AS st, count(*)::bigint AS n
        FROM public.permits
       WHERE state IS NOT NULL
         AND length(state) = 2
         AND upper(state) <> 'US'
       GROUP BY 1
    ) t;

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
