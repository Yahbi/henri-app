-- 00127_contractor_licenses_trust_column_guard.sql
-- 2026-08-04 audit — CLOSES A FORGEABLE TRUST BADGE SHOWN TO HOMEOWNERS.
--
-- ═══ APPLY THIS BEFORE 00123 ════════════════════════════════════════════
-- 00123_contractor_licenses_status_widen.sql widens the
-- `verification_status` CHECK so the roster vocabulary
-- ('verified_state_roster', 'manual_review', 'missing_in_roster',
-- 'pending_verification') becomes writable. Applying 00123 while this
-- guard is absent WIDENS the hole described below — a forger could then
-- also stamp 'verified_state_roster', the one value the UI treats as
-- "we matched this licence against a live state roster".
--
-- Required order:   00127 (this file)  →  00123
--
-- Both files are idempotent, so re-running either afterwards is safe; only
-- the window between them matters. Do NOT apply 00123 on its own.
--
-- ─── The hole ───────────────────────────────────────────────────────────
-- `contractor_licenses` has three RLS policies and nothing else
-- (00010:44-53, re-issued verbatim as 00061:216-232):
--
--     licenses_select_own / licenses_insert_own / licenses_update_own
--       USING / WITH CHECK ((SELECT auth.uid()) = contractor_id)
--
-- RLS gates ROWS, not COLUMNS. `authenticated` holds INSERT and UPDATE on
-- every column of the row it owns, and the browser genuinely talks to
-- PostgREST directly here: src/app/onboarding/license/page.tsx does
-- `.from("contractor_licenses").insert(...)` / `.update(...)` from a
-- browser client. So any signed-in contractor can run this from the
-- browser console:
--
--     supabase.from('contractor_licenses').insert({
--       contractor_id: '<their own uid>',
--       license_state: 'CA', license_number: 'X', verified: true })
--
-- and self-award a licence badge. NOTE: this works against the schema as
-- it stands TODAY — the 00010 CHECK is no obstacle, because omitting
-- `verification_status` lets the column DEFAULT 'pending' satisfy it. The
-- CHECK only blocks the LEGITIMATE onboarding write (which sets
-- 'verified_state_roster'); it has never blocked the forgery.
--
-- What that forged row buys, verbatim from the read paths:
--   • src/app/api/contractors/search/route.ts:97-105 — selects
--     `contractor_licenses` WHERE verified = true and an unexpired
--     expiry_date, and ships `license_verified: true` + `license_state` +
--     `license_verified_at` on the homeowner-facing search card.
--   • src/app/api/contractors/[id]/route.ts:70-78 — same query, same
--     badge, on the single-contractor public profile.
--
-- Both surfaces are read by HOMEOWNERS choosing who to let into their
-- house. This is the same class of hole 00117 closed on `profiles`
-- (badge_licensed / badge_insured / badge_background), reintroduced on a
-- different table when those reads were re-pointed here.
--
-- ─── Why a trigger and not column grants ────────────────────────────────
-- `REVOKE INSERT/UPDATE (col) ... FROM authenticated` is the other
-- standard fix but it is all-or-nothing per column, and it cannot express
-- the two rules this table actually needs:
--   1. On INSERT the row must START at the safe defaults (a new licence is
--      unverified until the server says otherwise) rather than being
--      rejected outright — the browser legitimately creates the row.
--   2. Changing the licence IDENTITY must INVALIDATE an existing
--      verification (see the reset block below), which no grant can do.
-- A BEFORE INSERT OR UPDATE trigger expresses both. Column grants can be
-- layered on later if every write moves server-side; the trigger stays
-- correct either way.
--
-- ─── Cost ───────────────────────────────────────────────────────────────
-- One `to_jsonb(NEW)`/`to_jsonb(OLD)` pair per write on
-- `contractor_licenses`. That table holds a handful of rows per
-- contractor and is written during onboarding, from /api/license/verify,
-- and by the license-check cron. It is on no hot path. The jsonb
-- comparison also makes the guard tolerant of columns that don't exist in
-- a given environment (both sides read as SQL NULL → not distinct → no
-- raise), so this is safe to apply against older branches.
--
-- ─── Idempotency ────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- Re-running is a no-op. Rollback is at the bottom of this file.

BEGIN;

CREATE OR REPLACE FUNCTION public.contractor_licenses_guard_trust_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  /* ── TRUST columns ──────────────────────────────────────────────────
     The verification verdict itself. Every one of these is produced by
     server code that talked to `state_license_rosters`, and none of them
     may be set or changed by an end-user session.

       verified             THE badge. /api/contractors/search:101 and
                            /api/contractors/[id]:74 filter on
                            `verified = true` and publish the result to
                            homeowners.
       verification_status  Which KIND of verdict. 'verified_state_roster'
                            is the only value that means a live roster
                            match (00123 documents the vocabulary); the
                            drawer and any future review queue read it.
       last_checked_at      When the check ran. Published as
                            `license_verified_at` — a "Roster-checked
                            <date>" line on the homeowner card. A
                            self-set value fakes freshness.
       expiry_date          An EXPIRED licence is not a licence. Both read
                            paths gate on
                            `expiry_date.is.null,expiry_date.gte.<today>`,
                            so a self-set future date keeps a dead
                            licence's badge alive. It is written from the
                            roster's `expire_date`, never from user input.
       raw_response         The audit trail for the verdict. If a user can
                            write it, it proves nothing. */
  c_trust constant text[] := ARRAY[
    'verified',
    'verification_status',
    'last_checked_at',
    'expiry_date',
    'raw_response'
  ];

  /* ── ANCHOR columns ─────────────────────────────────────────────────
     Identity and audit anchors. Locked for the same reason 00117 locks
     profiles.id / created_at.

       contractor_id  The RLS predicate itself. Moving a row to another
                      contractor would hand them the verification (and
                      the WITH CHECK on licenses_update_own only
                      constrains the NEW row, so re-pointing at yourself
                      from someone else's row is the mirror abuse).
       id             Row identity; /api/license/verify and the
                      license-check cron address rows by it.
       created_at     Audit anchor. */
  c_anchor constant text[] := ARRAY[
    'contractor_id',
    'id',
    'created_at'
  ];

  /* The column DEFAULT from 00010:26. Still a member of the widened CHECK
     in 00123, so this stays valid before and after that migration. */
  c_pending constant text := 'pending';

  v_actor text := current_user;
  v_old   jsonb;
  v_new   jsonb;
  v_col   text;
BEGIN
  /* Trusted DB roles pass straight through:
       service_role     — /api/onboarding/verify-license (which performs
                          the roster check AND persists the verdict),
                          /api/license/verify, the license-check cron, and
                          every other caller of src/lib/supabase/admin.ts
       postgres /
       supabase_admin   — migrations, the SQL editor, the Management API
       supabase_auth_admin — GoTrue's own bookkeeping

     NOTE for future work, identical to the one in 00117: `current_user`
     inside a SECURITY DEFINER function is the function OWNER, so any
     SECURITY DEFINER RPC that is EXECUTE-able by `authenticated` and
     writes `contractor_licenses` would bypass this guard. None exists
     today; if one is added it must re-check entitlement itself. */
  IF v_actor IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  v_new := to_jsonb(NEW);

  /* ═══ INSERT ═════════════════════════════════════════════════════════
     The browser legitimately creates this row during onboarding, so an
     INSERT is not rejected — but it must START unverified. A non-service
     session may supply ONLY the user-declared fields; anything it sends
     for a trust column is a forgery attempt and raises.

     `v_new -> col IS NOT NULL` distinguishes "column absent from this
     environment" (SQL NULL) from "column present and set to SQL NULL"
     (jsonb 'null'), which is what keeps the check tolerant of older
     branches. */
  IF TG_OP = 'INSERT' THEN
    /* contractor_id: RLS (licenses_insert_own) already requires
       auth.uid() = contractor_id. Re-checked here as defence in depth so
       the guard survives a policy edit. auth.uid() is NULL for sessions
       with no JWT — those cannot pass RLS at all, so skip rather than
       raise on them. */
    IF auth.uid() IS NOT NULL AND NEW.contractor_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'contractor_licenses.contractor_id must be the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    IF (v_new -> 'verified') IS NOT NULL
       AND (v_new -> 'verified') IS DISTINCT FROM to_jsonb(false) THEN
      RAISE EXCEPTION
        'contractor_licenses.verified cannot be set on insert; a new licence starts unverified'
        USING ERRCODE = '42501',
              HINT = 'Submit the licence, then let /api/onboarding/verify-license record the roster verdict with the service-role client (src/lib/supabase/admin.ts).';
    END IF;

    IF (v_new -> 'verification_status') IS NOT NULL
       AND (v_new -> 'verification_status') IS DISTINCT FROM to_jsonb(c_pending) THEN
      RAISE EXCEPTION
        'contractor_licenses.verification_status cannot be set on insert; it starts at %', c_pending
        USING ERRCODE = '42501',
              HINT = 'Omit the column and let the 00010 DEFAULT apply.';
    END IF;

    FOREACH v_col IN ARRAY ARRAY['last_checked_at', 'expiry_date', 'raw_response'] LOOP
      IF (v_new -> v_col) IS NOT NULL
         AND (v_new -> v_col) IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION
          'contractor_licenses.% is not user-writable; it records the outcome of a server-side roster check', v_col
          USING ERRCODE = '42501',
                HINT = 'Server code must perform this write with the service-role client (src/lib/supabase/admin.ts).';
      END IF;
    END LOOP;

    /* Belt and braces: a no-op while every deviation above raises, but it
       means a future column DEFAULT change cannot silently make a new row
       start verified. All five columns ship with the table in 00010, so
       the direct field references are always resolvable. */
    NEW.verified            := false;
    NEW.verification_status := c_pending;
    NEW.last_checked_at     := NULL;
    NEW.expiry_date         := NULL;
    NEW.raw_response        := NULL;

    RETURN NEW;
  END IF;

  /* ═══ UPDATE ═════════════════════════════════════════════════════════ */
  v_old := to_jsonb(OLD);

  FOREACH v_col IN ARRAY (c_trust || c_anchor) LOOP
    IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
      RAISE EXCEPTION
        'contractor_licenses.% is not user-writable; this column is set by verified licensing events only', v_col
        USING ERRCODE = '42501',
              HINT = 'Server code must perform this write with the service-role client (src/lib/supabase/admin.ts).';
    END IF;
  END LOOP;

  /* ── Re-declaring the licence invalidates the verification ───────────
     `license_number` and `license_state` stay user-writable (below), and
     without this block that would be a second forgery route: get licence
     A verified, then PATCH the row to point at licence B and keep the
     badge — the public card publishes the state and the check date, not
     the number, so nothing downstream would notice the swap.

     Forcing the reset (rather than raising) keeps the legitimate
     "Replace licence" flow working: the browser rewrites the declared
     fields, the row drops back to unverified, and
     /api/onboarding/verify-license re-checks it against the roster and
     re-stamps the verdict through the service-role client. */
  IF NEW.license_number IS DISTINCT FROM OLD.license_number
     OR NEW.license_state IS DISTINCT FROM OLD.license_state THEN
    NEW.verified            := false;
    NEW.verification_status := c_pending;
    NEW.last_checked_at     := NULL;
    NEW.expiry_date         := NULL;
    NEW.raw_response        := NULL;
  END IF;

  /* DELIBERATELY LEFT WRITABLE — documented so the next reader doesn't
     assume they were missed:

       license_number, license_state
         — what the contractor claims to hold. Typed by hand at
           src/app/onboarding/license/page.tsx and re-declarable from
           /api/compliance. A claim is not a verification; changing either
           resets the verdict via the block above.

       license_type, license_class, holder_name
         — user-declared descriptors ("C-39 Roofing", the name on the
           card). They carry no gate: nothing filters or badges on them.
           /api/onboarding/verify-license overwrites license_type and
           holder_name with the roster's values when a match is found,
           which is an improvement on the claim, not a gate over it.

       updated_at
         — moddatetime (00010:56-58). That trigger is named
           `licenses_updated_at`, which sorts AFTER this guard's name, so
           a rejected write never bumps it.

     NOT ADDRESSED HERE, because it cannot happen: DELETE. There is no
     DELETE policy on this table, so `authenticated` cannot drop a row it
     dislikes and insert a fresh one. If a DELETE policy is ever added,
     this guard must grow a DELETE branch or the reset logic above becomes
     bypassable. */

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.contractor_licenses_guard_trust_columns() IS
  'BEFORE INSERT OR UPDATE guard on public.contractor_licenses. RLS gates '
  'rows, not columns, so licenses_insert_own / licenses_update_own (00010, '
  '00061) let any authenticated contractor set verified = true from the '
  'browser and self-award the "Licensed" badge that /api/contractors/search '
  'and /api/contractors/[id] publish to homeowners. Raises 42501 (PostgREST '
  '-> HTTP 403) when a non-service-role session sets or changes a trust '
  'column, and resets the verdict when the declared licence changes. See '
  '00127 for the full column map. Apply BEFORE 00123.';

DROP TRIGGER IF EXISTS contractor_licenses_guard_trust_columns ON public.contractor_licenses;

/* Fires before `licenses_updated_at` (moddatetime) by name ordering, so a
   rejected write never bumps updated_at. FOR EACH ROW + WHEN-less because
   the column set is resolved dynamically inside the function. */
CREATE TRIGGER contractor_licenses_guard_trust_columns
  BEFORE INSERT OR UPDATE ON public.contractor_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.contractor_licenses_guard_trust_columns();

COMMIT;

-- ─── Verification (run as an ordinary signed-in contractor, NOT service role) ──
--   -- should raise 42501 (the forgery this migration exists to stop):
--   insert into public.contractor_licenses
--     (contractor_id, license_number, license_state, verified)
--     values (auth.uid(), 'X', 'CA', true);
--   update public.contractor_licenses set verified = true where contractor_id = auth.uid();
--   update public.contractor_licenses set expiry_date = '2099-01-01' where contractor_id = auth.uid();
--   update public.contractor_licenses set last_checked_at = now() where contractor_id = auth.uid();
--   update public.contractor_licenses set contractor_id = '<other uuid>' where contractor_id = auth.uid();
--
--   -- should SUCCEED (the declared fields the onboarding form writes):
--   insert into public.contractor_licenses
--     (contractor_id, license_number, license_state, license_type, holder_name)
--     values (auth.uid(), '1098765', 'TX', 'General B', 'Jane Doe');
--   update public.contractor_licenses set license_type = 'C-39 Roofing' where contractor_id = auth.uid();
--
--   -- should SUCCEED and leave the row unverified (identity change resets):
--   --   (run after a service-role session has stamped verified = true)
--   update public.contractor_licenses set license_number = 'DIFFERENT' where contractor_id = auth.uid();
--   select verified, verification_status from public.contractor_licenses where contractor_id = auth.uid();
--   --   expect: false, 'pending'
--
-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS contractor_licenses_guard_trust_columns ON public.contractor_licenses;
--   DROP FUNCTION IF EXISTS public.contractor_licenses_guard_trust_columns();
-- (Reverting restores a homeowner-facing badge that any contractor can
--  forge from the browser console. Prefer narrowing c_trust over dropping
--  the trigger if a legitimate write turns out to be blocked.)
