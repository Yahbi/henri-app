-- Migration 00080: drop unused PostGIS extension to clear the
-- `rls_disabled_in_public` advisor finding on spatial_ref_sys.
--
-- Background
-- ──────────
-- The 2026-05-03 Supabase advisor flagged `public.spatial_ref_sys`
-- (CRITICAL: Table publicly accessible — RLS not enabled). The PostGIS
-- extension owns spatial_ref_sys, so the project-owner role cannot run
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY on it (`ERROR 42501: must
-- be owner of table`).
--
-- After probing the actual usage:
--   - PostGIS was installed via migration 00001 in the public schema
--     (default — no SCHEMA clause was provided).
--   - The single user-table dependency is `permits.location`
--     (`geography(Point, 4326)`, added in migration 00004).
--   - Live row count 2026-05-06: 0 / 1,414,624 permits have a non-null
--     `location` value. The column was added speculatively for future
--     spatial queries that never materialised.
--   - No migration uses `ST_DWithin`, `ST_Distance`, `ST_Within`, or
--     any other PostGIS function.
--   - Application code under `src/` uses lat/lng float columns
--     directly. The single fallback at `api/leads/map/route.ts` that
--     read `permit.location` was retired alongside this migration
--     (the column was always null in production, so the fallback path
--     never fired).
--
-- Therefore PostGIS is dead code in Henri. Dropping it cleanly:
--   1. Removes spatial_ref_sys → clears the advisor finding.
--   2. Removes geography_columns + geometry_columns (the other two
--      PostGIS-owned views in `public`).
--   3. Drops `permits.location` via DROP EXTENSION CASCADE — losing
--      no data because it's empty.
--
-- If we ever need PostGIS again, reinstall in the `extensions` schema
-- per Supabase's recommended pattern:
--
--   CREATE EXTENSION postgis SCHEMA extensions;
--
-- That avoids re-introducing the `rls_disabled_in_public` finding.

-- Idempotent: only act if PostGIS is currently installed in public.
DO $$
DECLARE
  ext_schema text;
  v_with_location bigint;
BEGIN
  SELECT n.nspname
    INTO ext_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';

  IF ext_schema IS NULL THEN
    RAISE NOTICE 'PostGIS not installed; nothing to do.';
    RETURN;
  END IF;

  IF ext_schema <> 'public' THEN
    RAISE NOTICE 'PostGIS already in % schema (not public); skipping.', ext_schema;
    RETURN;
  END IF;

  -- Sanity check: confirm the geography column is empty before we
  -- drop it via CASCADE. If a future ingest started populating it,
  -- this migration aborts and surfaces the issue instead of silently
  -- discarding data.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'permits'
      AND column_name = 'location'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM public.permits WHERE location IS NOT NULL'
      INTO v_with_location;
    IF v_with_location > 0 THEN
      RAISE EXCEPTION
        'Migration 00080 aborted: permits.location has % non-null rows. '
        'Dropping it via DROP EXTENSION CASCADE would discard real data. '
        'Investigate (something started writing to permits.location) '
        'and update this migration before re-running.',
        v_with_location;
    END IF;
  END IF;

  -- Drop the extension. CASCADE removes:
  --   * public.spatial_ref_sys (8500 reference rows — recreatable)
  --   * public.geography_columns (PostGIS-owned view)
  --   * public.geometry_columns (PostGIS-owned view)
  --   * public.permits.location (geography column, confirmed empty)
  EXECUTE 'DROP EXTENSION postgis CASCADE';
  RAISE NOTICE 'PostGIS dropped from public schema.';
END $$;
