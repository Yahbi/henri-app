-- 00059_revoke_public_execute.sql
-- 2026-04-29 follow-up to 00058. The previous REVOKE FROM anon/authenticated
-- didn't reduce the advisor warnings because PostgreSQL's default grant is
-- to PUBLIC (the empty-grantee pseudo-role that all roles inherit from).
-- Verified via pg_proc.proacl — every flagged function had a leading
-- `=X/postgres` entry meaning PUBLIC has EXECUTE.
--
-- The correct lockdown pattern is:
--   1. REVOKE EXECUTE ... FROM PUBLIC  (removes the default grant)
--   2. GRANT EXECUTE ... TO <specific role>  (only where needed)
--
-- Caller analysis (from src/ on 2026-04-29):
--   claim_territory + release_territory + get_or_create_referral_code
--     → authenticated app routes only. GRANT to authenticated.
--   process_referral_signup + refresh_contractor_stats +
--   refresh_market_intel_zip + handle_new_user
--     → service-role only. service_role bypasses ACL, no GRANT needed.
--
-- Idempotency: REVOKE FROM PUBLIC is a no-op when already revoked;
-- GRANT TO authenticated is a no-op when already granted.

BEGIN;

-- ── Authenticated-callable (revoke PUBLIC, grant authenticated) ──
REVOKE EXECUTE ON FUNCTION public.claim_territory(p_zip varchar, p_contractor_id uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_territory(p_zip varchar, p_contractor_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.release_territory(p_zip varchar, p_contractor_id uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.release_territory(p_zip varchar, p_contractor_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_or_create_referral_code(p_contractor_id uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_or_create_referral_code(p_contractor_id uuid) TO authenticated;

-- ── Service-role-only (revoke PUBLIC, no GRANT) ──
REVOKE EXECUTE ON FUNCTION public.process_referral_signup(p_referral_code text, p_new_user_id uuid, p_new_user_email text, p_new_user_role text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_contractor_stats(p_contractor_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_market_intel_zip() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- ── PostGIS internals (best-effort; extension-owned may reject) ──
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text) FROM PUBLIC;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN NULL; END $$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text) FROM PUBLIC;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN NULL; END $$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text, boolean) FROM PUBLIC;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN NULL; END $$;

COMMIT;

-- Verify after applying:
--   SELECT proname, proacl FROM pg_proc WHERE proname IN (
--     'claim_territory', 'release_territory', 'get_or_create_referral_code',
--     'process_referral_signup', 'refresh_contractor_stats',
--     'refresh_market_intel_zip', 'handle_new_user'
--   );
--   -- proacl should NOT start with `=X/postgres` anymore.
