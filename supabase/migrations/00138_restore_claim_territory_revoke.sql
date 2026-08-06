-- 00138_restore_claim_territory_revoke.sql
-- 2026-08-06 — undo a security regression introduced by 00135.
--
-- ─── What happened ──────────────────────────────────────────────────────
-- 00112 closed an IDOR on claim_territory / release_territory:
--
--     REVOKE EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
--       FROM PUBLIC, anon, authenticated;
--     GRANT  EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
--       TO service_role;
--
-- The RPC takes `p_contractor_id` as a PARAMETER and is SECURITY DEFINER, so
-- any signed-in user holding EXECUTE could call it through PostgREST with a
-- contractor_id that is not their own and claim territory on another
-- contractor's account. The app never needs that grant: every call goes
-- through `createAdminClient()` (service role) in src/lib/territory/ziplock.ts,
-- reached only via /api/territories, which authenticates the session and
-- passes `user.id` itself.
--
-- 00135 rewrote the function body and re-attached a grant line copied from the
-- older 00059 pattern:
--
--     GRANT EXECUTE ON FUNCTION public.claim_territory(...) TO authenticated;
--
-- CREATE OR REPLACE preserves existing grants, so that line did not merely
-- restate the status quo — it re-opened the exact hole 00112 closed. The same
-- mistake is easy to repeat because two migrations (00059 and 00112) disagree
-- about the correct grant and 00059 reads like the newer convention.
--
-- ─── The rule ───────────────────────────────────────────────────────────
-- Any SECURITY DEFINER function that accepts an actor id as an argument must
-- be service_role-only. Authorisation lives in the route that knows the
-- session, not in a function that will trust whatever id it is handed.
--
-- release_territory is re-asserted here as well: 00135 did not touch it, but
-- it shares the flaw and the assertion is free.
--
-- Idempotent. Rollback at the bottom (deliberately NOT recommended).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_territory(character varying, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_territory(character varying, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_territory(character varying, uuid)
  TO service_role;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Do not run this. Granting either function to `authenticated` re-opens the
-- IDOR that 00112 closed and 00138 re-closed.
--   GRANT EXECUTE ON FUNCTION public.claim_territory(character varying, uuid) TO authenticated;
