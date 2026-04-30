-- 00058_security_definer_lockdown.sql
-- 2026-04-29 audit follow-up: lock down SECURITY DEFINER functions.
--
-- Each function below was flagged by the Supabase security advisor as
-- callable via /rest/v1/rpc/<name> by anon and/or authenticated roles.
-- REVOKE EXECUTE narrows the surface so only the role that actually
-- needs it can call. Service-role (used by cron + admin client paths)
-- bypasses these grants entirely, so cron/webhook code stays working.
--
-- Per-function rationale (from src/ caller analysis on 2026-04-29):
--   claim_territory / release_territory / get_or_create_referral_code
--     → called from authenticated routes only (browser/server Supabase
--       client with session). REVOKE anon, KEEP authenticated.
--   process_referral_signup
--     → called only by /api/referrals/validate via createAdminClient.
--       REVOKE anon + authenticated; service-role bypass.
--   refresh_contractor_stats
--     → called by cron + /api/reviews via createAdminClient.
--       REVOKE anon + authenticated; service-role bypass.
--   refresh_market_intel_zip
--     → called only by /api/cron/market-intel via service-role.
--       REVOKE anon + authenticated; service-role bypass.
--   handle_new_user
--     → trigger function on auth.users INSERT. NO direct RPC callers
--       in src/. The trigger fires with definer privileges regardless
--       of grants, so REVOKE-ing public access is safe.
--
-- NOT touched in this migration:
--   get_zip_availability — used by lib/territory/ziplock.ts, may be
--     called from public marketing pages for the ZIP availability widget.
--     Anon access is intentional. Documented as accepted-risk.
--   PostGIS st_estimatedextent (3 variants) — extension-owned function.
--     REVOKE may fail with "must be owner" on managed Supabase. Attempted
--     in a guarded DO block; failure is non-fatal.
--
-- Idempotency: REVOKE on a non-existent grant is a no-op; safe to re-run.

BEGIN;

-- ── 1. Authenticated-only territory + referral functions ──
REVOKE EXECUTE ON FUNCTION public.claim_territory(p_zip varchar, p_contractor_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_territory(p_zip varchar, p_contractor_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_referral_code(p_contractor_id uuid) FROM anon;

-- ── 2. Service-role-only (cron + admin-client) functions ──
REVOKE EXECUTE ON FUNCTION public.process_referral_signup(p_referral_code text, p_new_user_id uuid, p_new_user_email text, p_new_user_role text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_contractor_stats(p_contractor_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_market_intel_zip() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- ── 3. PostGIS internals (best-effort; may be skipped if extension-owned) ──
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text) FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
  -- Extension-owned function; cannot revoke from project role. Accepted risk.
  NULL;
END $$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text) FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
  NULL;
END $$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text, boolean) FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
  NULL;
END $$;

COMMIT;

-- Verify after applying:
--   SELECT proname, proacl FROM pg_proc
--   WHERE proname IN (
--     'claim_territory', 'release_territory', 'get_or_create_referral_code',
--     'process_referral_signup', 'refresh_contractor_stats',
--     'refresh_market_intel_zip', 'handle_new_user'
--   );
--   -- proacl should NOT contain `anon=X/...` after REVOKE.
