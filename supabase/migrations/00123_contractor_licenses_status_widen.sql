-- 00123_contractor_licenses_status_widen.sql
-- 2026-08-04 audit — the licence onboarding write can never succeed.
--
-- ─── The break ──────────────────────────────────────────────────────────
-- 00010:26-27 declared:
--
--     verification_status text NOT NULL DEFAULT 'pending'
--       CHECK (verification_status IN
--              ('pending','verified','failed','expired','revoked'))
--
-- but src/app/onboarding/license/page.tsx:192-199 writes one of four
-- values that Wave 2.B introduced and that nothing ever added to the
-- CHECK:
--
--     verified_state_roster   -- roster cross-check matched
--     manual_review           -- state not in state_license_rosters
--     missing_in_roster       -- state covered, licence not found
--     pending_verification    -- cross-check itself errored
--
-- Every one of them violates the constraint, so the INSERT/UPDATE at
-- page.tsx:222-231 raises. The handler does `throw licenseErr`, which
-- skips the `profiles.license_state` / `license_number` mirror write two
-- statements later — the exact write the /onboarding/plan middleware gate
-- reads. Net effect: a contractor submitting a licence sees "Could not
-- save license" and is bounced back to /onboarding/license forever, and
-- `contractor_licenses` stays empty.
--
-- ─── Why it matters beyond onboarding ───────────────────────────────────
-- `contractor_licenses.verified` is now the ONLY input to the "Licensed"
-- badge shown to homeowners (/api/contractors/search + /api/contractors/
-- [id], reworked in the same pass). Those routes deliberately stopped
-- reading profiles.badge_licensed / badge_insured / badge_background,
-- which have no writer at all and are hard-locked by 00117. With this
-- constraint in place no row can ever reach verified=true, so the badge
-- correctly renders for nobody — honest, but only because the pipeline is
-- broken upstream. This migration unblocks it.
--
-- ─── Why widen instead of remapping the app to the old vocabulary ───────
-- The four new values carry information the old five don't: 'failed'
-- can't distinguish "we checked and this licence isn't in the roster"
-- (missing_in_roster — a red flag) from "we don't hold a roster for this
-- state" (manual_review — no signal either way). Collapsing them would
-- destroy the distinction the drawer and any future review queue need.
-- The five original values are kept so existing rows and any older writer
-- stay valid — this is purely additive.
--
-- ─── Idempotency ────────────────────────────────────────────────────────
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Re-running is a no-op.
-- Rollback is at the bottom.
--
-- NOT APPLIED. The production instance is recovering from disk-I/O
-- exhaustion; apply via scripts/_apply-migration-*.mjs once it is healthy.

BEGIN;

ALTER TABLE public.contractor_licenses
  DROP CONSTRAINT IF EXISTS contractor_licenses_verification_status_check;

ALTER TABLE public.contractor_licenses
  ADD CONSTRAINT contractor_licenses_verification_status_check
  CHECK (verification_status IN (
    -- 00010 vocabulary, retained so existing rows stay valid.
    'pending',
    'verified',
    'failed',
    'expired',
    'revoked',
    -- Wave 2.B roster cross-check vocabulary, written by
    -- src/app/onboarding/license/page.tsx via /api/onboarding/verify-license.
    'pending_verification',
    'verified_state_roster',
    'manual_review',
    'missing_in_roster'
  ));

COMMENT ON COLUMN public.contractor_licenses.verification_status IS
  'Outcome of the state-roster cross-check. verified_state_roster is the '
  'only value that represents a live match against state_license_rosters, '
  'and it is the only one that should ever accompany verified = true. '
  'manual_review means no roster is held for that state (no signal); '
  'missing_in_roster means the roster was searched and did not contain '
  'the licence. See 00123 for why the 00010 CHECK had to widen.';

COMMIT;

-- ─── Verification ───────────────────────────────────────────────────────
--   -- should all succeed after this migration, all fail before it:
--   INSERT INTO public.contractor_licenses
--     (contractor_id, license_number, license_state, verification_status)
--   VALUES (<uuid>, 'TEST-1', 'TX', 'verified_state_roster');
--   -- should still fail (typo guard intact):
--   ... VALUES (<uuid>, 'TEST-2', 'TX', 'totally_made_up');
--
-- ─── Rollback ───────────────────────────────────────────────────────────
--   ALTER TABLE public.contractor_licenses
--     DROP CONSTRAINT IF EXISTS contractor_licenses_verification_status_check;
--   ALTER TABLE public.contractor_licenses
--     ADD CONSTRAINT contractor_licenses_verification_status_check
--     CHECK (verification_status IN
--            ('pending','verified','failed','expired','revoked'));
-- (Reverting re-breaks licence onboarding — delete the offending rows
--  first or the ADD will fail.)
