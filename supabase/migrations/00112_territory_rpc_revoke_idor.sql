-- ─────────────────────────────────────────────────────────────────────
-- 00112 · Close the release_territory / claim_territory IDOR
--
-- 2026-06-17 deep-eval finding (verified live): release_territory is
-- SECURITY DEFINER with NO check that auth.uid() = p_contractor_id, and was
-- EXECUTE-granted to `authenticated`. Because territories are readable, any
-- signed-in user could read a rival's (contractor_id, zip) and call
-- POST /rest/v1/rpc/release_territory directly to evict a PAYING competitor
-- and promote the first waitlister — a clean break of the exclusivity wedge,
-- bypassing the app route and its auth.
--
-- The app ONLY ever calls these RPCs via the service-role admin client
-- (src/lib/territory/ziplock.ts uses createAdminClient for both claim and
-- release), so the `authenticated` role never needs direct EXECUTE. Revoke it
-- (and from anon/PUBLIC), keep service_role. This is the Supabase advisor's
-- own remediation for lints 0028/0029 and is zero-risk to legitimate calls.
--
-- claim_territory gets the same treatment (defense in depth; it already has
-- the migration-00106 payment gate, but it's likewise admin-only).
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

REVOKE EXECUTE ON FUNCTION public.release_territory(character varying, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_territory(character varying, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
  TO service_role;

COMMIT;
