-- 00056_cost_benchmarks_rls.sql
-- Audit-04-29 fix: cost_benchmarks was created in 00016_marketplace_engine.sql
-- WITHOUT row-level security. Every other domain table in Henri has RLS
-- enabled in its creation migration; this one slipped through.
--
-- Threat model: cost_benchmarks holds per-trade × per-ZIP-prefix cost
-- envelopes (cost_low / cost_avg / cost_high) that drive the homeowner
-- estimator and contractor-facing pricing context. It's reference data
-- (not user-owned) so the safe posture is:
--   - SELECT  → authenticated users (the estimator UI runs on the browser
--               Supabase client and needs read access)
--   - INSERT  → service-role ONLY (cron / admin scripts; bypasses RLS)
--   - UPDATE  → service-role ONLY
--   - DELETE  → service-role ONLY
--
-- Without an INSERT/UPDATE/DELETE policy declared, RLS implicitly denies
-- those verbs to non-service-role callers, which is exactly what we want.
--
-- Idempotency: re-runs are safe — `ENABLE ROW LEVEL SECURITY` is a no-op
-- when already enabled, and `DROP POLICY IF EXISTS` + recreate is the
-- standard pattern across the migration tree.

BEGIN;

-- Enable RLS. No-op if already enabled.
ALTER TABLE cost_benchmarks ENABLE ROW LEVEL SECURITY;

-- Drop and recreate the read policy so re-application is idempotent.
DROP POLICY IF EXISTS cost_benchmarks_select_authenticated ON cost_benchmarks;

CREATE POLICY cost_benchmarks_select_authenticated
  ON cost_benchmarks
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY cost_benchmarks_select_authenticated ON cost_benchmarks IS
  'Reference table — every authenticated session can read cost envelopes
  for the estimator UI. Writes are service-role only (no INSERT/UPDATE/
  DELETE policies declared, which RLS implicitly denies).';

COMMIT;

-- Apply path:
--   pnpm migrate                                    (preferred, requires SUPABASE_ACCESS_TOKEN)
--   OR paste into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new
--
-- Verify:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'cost_benchmarks';
--   -- relrowsecurity should be true.
--   SELECT polname FROM pg_policy WHERE polrelid = 'cost_benchmarks'::regclass;
--   -- expect: cost_benchmarks_select_authenticated
