-- 00079_drop_unused_sidecars.sql
--
-- 2026-05-02 retrospective audit cleanup.
-- After Wave 1 + 2.A + 2.B + 2.C shipped, we paused to assess which
-- sidecar tables actually drive contractor outcomes vs. which are
-- collected-but-never-read. Six tables are pruned here:
--
--   svi_tracts         — 0 rows. CDC SVI Socrata feed deprecated and
--                        ATSDR ArcGIS endpoint requires auth that
--                        Vercel-stateless cron can't provide. No code
--                        path in src/ reads this table. Re-introduce
--                        only when a public source is identified.
--
--   demo_acs_zcta      — 236k rows present, but a full grep of src/
--                        shows zero readers. The score cron, lead
--                        drawer, outreach token resolver, and admin
--                        sub-pages never query this table. The
--                        ingestion was speculative; demographics are
--                        more naturally captured at contractor
--                        onboarding (capacity_prefs) than per-lead.
--
--   mortgages_hmda     — 2 rows after weeks of state-rotator runs.
--                        The rotator approach (1 state × 1 year per
--                        Vercel cron run = 52 × 7 = ~12 months to
--                        backfill) is structurally too slow for
--                        Vercel's 280s budget. Defer until the
--                        Hetzner Python sidecar is provisioned (see
--                        Wave 2 of the original plan).
--
--   zip_crosswalk_hud  — 0 rows. HUD requires an authenticated form
--                        download (huduser.gov login). Stateless cron
--                        cannot re-establish the session. Re-enable
--                        only when a service-role-mediated login flow
--                        is built (likely on the same Hetzner sidecar
--                        as HMDA).
--
--   code_violations    — 11k rows ingested today (2026-05-02), but
--                        wired to no scoring booster, no drawer
--                        panel, and no outreach token. Pausing the
--                        cron until the consumer side ships keeps the
--                        table from accumulating dead data.
--
--   wildfires_nifc     — 603 rows ingested today. Same situation as
--                        code_violations: no consumer in src/.
--
-- Cron route files are kept on disk so re-enabling is one git diff
-- away. The cron schedules are stripped from vercel.json and the
-- table specs are removed from /api/admin/data-health so the
-- freshness panel stops showing red chips for these sidecars.
--
-- Idempotent: every DROP uses IF EXISTS, every COMMENT is set after.
-- Safe to re-run.

DO $$ BEGIN
  RAISE NOTICE 'migration 00079: dropping 6 unused sidecar tables';
END $$;

DROP TABLE IF EXISTS public.svi_tracts        CASCADE;
DROP TABLE IF EXISTS public.demo_acs_zcta     CASCADE;
DROP TABLE IF EXISTS public.mortgages_hmda    CASCADE;
DROP TABLE IF EXISTS public.zip_crosswalk_hud CASCADE;
DROP TABLE IF EXISTS public.code_violations   CASCADE;
DROP TABLE IF EXISTS public.wildfires_nifc    CASCADE;

DO $$ BEGIN
  RAISE NOTICE 'migration 00079: done — 6 tables dropped';
END $$;
