-- ─────────────────────────────────────────────────────────────────────
-- 00111 · Revoke direct RPC on the stage-history trigger function
--
-- 2026-06-11 security advisor (0028 anon_security_definer_function_executable):
-- record_stage_history() is a TRIGGER function (fires on opportunity_stage
-- changes) but was also EXECUTE-granted to anon/authenticated, exposing it at
-- /rest/v1/rpc/record_stage_history. Trigger functions never need direct RPC
-- access — the trigger invokes them in the table-owner context regardless of
-- role grants. Revoke the needless surface. Idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

REVOKE EXECUTE ON FUNCTION public.record_stage_history()
  FROM PUBLIC, anon, authenticated;

COMMIT;
