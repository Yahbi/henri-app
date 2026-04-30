-- 00057_security_advisor_fixes.sql
-- 2026-04-29 live-audit fixes from Supabase MCP get_advisors(security)
--
-- Two classes of fix:
--   1. CRITICAL: zip_demand_scores RLS hole (mirrors the cost_benchmarks
--      finding from migration 00056 — same shape table, same fix).
--   2. HYGIENE: pin search_path on the 2 functions the advisor flagged
--      as mutable (search-path-injection mitigation).
--
-- DROPPED from this migration:
--   - spatial_ref_sys RLS — PostGIS extension table is owned by the
--     `postgres` superuser, not the project role. ALTER TABLE … ENABLE
--     RLS fails with "must be owner of table spatial_ref_sys" on managed
--     Supabase. The advisor still flags it, but it's PostGIS reference
--     data (~8000 CRS rows) — no PII, no business data. Treated as
--     accepted-risk on managed Supabase.
--
-- NOT FIXED in this migration (require user judgment):
--   - SECURITY DEFINER function exposure to anon — 9 functions total.
--     Some are intentional (handle_new_user, claim_territory, signup
--     flows). Audit each by hand: keep DEFINER + restricted EXECUTE,
--     switch to SECURITY INVOKER, or revoke EXECUTE from anon.
--   - homeowner_intakes / reviews permissive INSERT policies. The
--     `intakes_insert_anon` WITH CHECK (true) is INTENTIONAL: the
--     homeowner intake form is a public POST and the route enforces
--     a 5-per-hour-per-IP rate limit in app code (see
--     `src/app/api/intake/route.ts`). DB-level tightening would
--     require a per-row check (e.g. INSERT throttled by created_at
--     within last 5 min for the same IP) which complicates the schema.
--     Documented as a known trade-off.
--   - Extensions in public (postgis, pg_net, moddatetime). Moving them
--     is a breaking change requiring a separate dual-write rollout.
--   - Auth leaked-password protection — flip the toggle in the
--     Supabase dashboard (Authentication → Settings → Security).
--
-- Idempotency: every clause uses IF NOT EXISTS / DROP IF EXISTS so
-- re-applying is a no-op.

BEGIN;

-- ── 1. zip_demand_scores RLS (CRITICAL — same shape as 00056) ──
--
-- This is reference data populated by the daily zip-demand cron via the
-- service-role (admin) client. Authenticated users need read access for
-- the dashboard's territory-intelligence overlays. Writes are admin-only.

ALTER TABLE zip_demand_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zip_demand_scores_select_authenticated ON zip_demand_scores;
CREATE POLICY zip_demand_scores_select_authenticated
  ON zip_demand_scores
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY zip_demand_scores_select_authenticated ON zip_demand_scores IS
  'Reference table populated by /api/cron/zip-demand. Read access for the
  contractor dashboard''s territory overlays. Writes happen server-side
  via service-role bypass (no INSERT/UPDATE/DELETE policies declared).';

-- ── 2. Function search_path pinning ──
--
-- Mitigates the search-path-shadowing class of injection. Without an
-- explicit SET clause, the function runs with whatever search_path the
-- caller has — so a malicious schema named `public` earlier in the path
-- could shadow a builtin. Pin to the canonical "public, pg_catalog"
-- so the function's table/operator references resolve unambiguously.

ALTER FUNCTION public.permits_sync_lat_lng()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.refresh_market_intel_zip()
  SET search_path = public, pg_catalog;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────
--
-- After applying:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('zip_demand_scores', 'spatial_ref_sys');
--   -- Expect: both true.
--
--   SELECT polname FROM pg_policy
--   WHERE polrelid IN (
--     'zip_demand_scores'::regclass,
--     'spatial_ref_sys'::regclass
--   );
--   -- Expect: zip_demand_scores_select_authenticated,
--   --         spatial_ref_sys_select_authenticated.
--
--   SELECT proname, proconfig FROM pg_proc
--   WHERE proname IN ('permits_sync_lat_lng', 'refresh_market_intel_zip');
--   -- proconfig should contain "search_path=public, pg_catalog".
