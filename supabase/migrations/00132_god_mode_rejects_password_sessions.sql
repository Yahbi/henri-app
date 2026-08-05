-- 00132_god_mode_rejects_password_sessions.sql
-- 2026-08-05 — NEUTRALISES A PUBLISHED PASSWORD WITHOUT TOUCHING THE CREDENTIAL.
--
-- ─── The exposure ───────────────────────────────────────────────────────
-- /api/dev/auto-login carried a literal password default and wrote it onto
-- the founder's PRODUCTION account with the service-role key from .env.local.
-- The value is committed to Yahbi/henri-app, which is a PUBLIC repository, so
-- the string has been readable by anyone since commit 91d1400. The founder's
-- email sits on the line above it, and the Supabase project URL and anon key
-- ship in the browser bundle by design. GoTrue's grant_type=password endpoint
-- is public. That is a complete, remotely-usable login.
--
-- What it unlocks is the whole dataset: `leads_select_godmode` is USING
-- (is_god_mode()), so a god-mode session reads all 274,783 leads including
-- owner names and phone numbers.
--
-- Removing the password identity and disabling the Email+Password provider is
-- the real fix and is an operator action in the Supabase dashboard. This
-- migration makes that exposure inert in the meantime, from the side we DO
-- control — authorization logic.
--
-- ─── Why auth method is the right discriminator ─────────────────────────
-- God mode is granted by EMAIL (membership in god_mode_emails), not by any
-- particular credential. So the account can keep its god mode while the
-- PASSWORD stops being a route to it.
--
-- Every session records how it was established. Live on 2026-08-05:
--
--   auth.mfa_amr_claims.authentication_method
--     oauth     2026-04-29 .. 2026-05-01   <- every genuine founder sign-in
--     password  2026-08-05 20:44           <- the dev-login route
--     password  2026-04-16 04:45           <- dev-contractor creation
--
-- Every real sign-in this account has ever made is `oauth`. Nothing a human
-- actually does here is password-derived, so refusing god mode to
-- password-derived sessions costs nothing and closes the published-string
-- path completely. Google OAuth and magic-link (otp) sessions are unaffected.
--
-- ─── Fail-open on absence, deliberately ─────────────────────────────────
-- Two independent signals are consulted, and EITHER saying "password" denies:
--   1. the `amr` claim inside the JWT, when present
--   2. auth.mfa_amr_claims joined on the JWT's session_id — authoritative,
--      and does not depend on the claim being minted into the token
--
-- If NEITHER signal is available the function behaves exactly as before. That
-- is chosen on purpose: a fail-CLOSED version would lock the founder out of
-- god mode entirely the moment Supabase changed a claim name, and this is a
-- defence-in-depth layer, not the primary control. The primary control is
-- disabling the password provider.
--
-- Idempotent: CREATE OR REPLACE. Rollback at the bottom.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_god_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    -- (1) The allowlist, unchanged. God mode is an email property.
    EXISTS (
      SELECT 1 FROM public.god_mode_emails g
      WHERE lower(g.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    -- (2) ...but never from a password-derived session.
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                 THEN auth.jwt() -> 'amr'
               ELSE '[]'::jsonb
             END
           ) AS e
      WHERE e ->> 'method' = 'password'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM auth.mfa_amr_claims c
      WHERE c.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        AND c.authentication_method = 'password'
    );
$function$;

COMMENT ON FUNCTION public.is_god_mode() IS
  'God mode: email must be in god_mode_emails AND the session must not be password-derived. A repo-committed password was live on the founder''s production account (public repo), and this makes it useless for reaching god mode without touching the credential itself. Every genuine founder sign-in on record is oauth. See 00132.';

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Appropriate once the Email+Password provider is disabled project-wide, at
-- which point no password session can exist and this check is redundant.
--
--   CREATE OR REPLACE FUNCTION public.is_god_mode()
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path TO 'public', 'pg_temp'
--   AS $$
--     SELECT EXISTS (
--       SELECT 1 FROM public.god_mode_emails g
--       WHERE lower(g.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
--     );
--   $$;
