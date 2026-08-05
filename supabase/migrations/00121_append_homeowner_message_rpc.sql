-- ─────────────────────────────────────────────────────────────────────
-- 00121 · append_homeowner_message() — the homeowner message WRITE lane.
--
-- 00116 opened the two READ lanes homeowner messaging needs
-- (intakes_update_own_email + leads_select_homeowner) and deliberately
-- left the send path closed, with the reasoning in its footer: a broad
-- UPDATE policy on public.leads would hand a homeowner every
-- contractor-owned column on the row (score, status, contractor_id,
-- owner contact fields) just to let them append one line of chat.
--
-- This is the narrow alternative that footer specifies. POST
-- /api/homeowner/messages currently issues a direct .update() on
-- leads.notes; leads_update_own is contractor-scoped, so RLS narrows the
-- target set to zero rows and PostgREST answers 204 — a silent no-op the
-- route cannot distinguish from a real write. The function below is the
-- only write surface a homeowner gets: it re-checks ownership itself,
-- appends exactly one line to `notes`, and touches nothing else.
--
-- SECURITY DEFINER is what makes the append land at all (it runs as the
-- owner, so leads_update_own no longer filters it out), which means every
-- guard has to live inside the function body:
--
--   * ownership  — the caller must own an intake whose matched_lead_id is
--                  p_lead_id, matched on lower(contact_email) = lower(JWT
--                  email). Same predicate as 00116's SELECT lane, so read
--                  access and write access can never diverge.
--   * newlines   — collapsed before the line is built (see below).
--   * length     — bounded at 4000 chars, mirroring the Zod cap on
--                  HomeownerMessageBodySchema so the DB is not the looser
--                  of the two.
--   * columns    — the UPDATE sets `notes` and nothing else. `updated_at`
--                  is left to the existing leads_updated_at moddatetime
--                  trigger.
--   * landing    — ROW_COUNT is asserted, so "wrote nothing" raises
--                  instead of returning success. That is what lets the
--                  route stop guessing whether the send worked.
--
-- Every failure raises P0001, so supabase-js reports a real error object
-- rather than {data:null, error:null}.
--
-- Additive and re-runnable. No policy, table, or existing function is
-- modified.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop-then-create rather than CREATE OR REPLACE: replacing cannot change
-- a return type, so a re-run against a differently-shaped earlier version
-- would fail. Signature-qualified so it can only ever hit this function.
DROP FUNCTION IF EXISTS public.append_homeowner_message(uuid, text);

CREATE FUNCTION public.append_homeowner_message(p_lead_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email   text;
  v_body    text;
  v_line    text;
  v_written int;
BEGIN
  v_email := lower(coalesce((SELECT auth.jwt() ->> 'email'), ''));

  IF v_email = '' THEN
    RAISE EXCEPTION 'homeowner_message_forbidden: no authenticated email on the request'
      USING ERRCODE = 'P0001';
  END IF;

  -- Ownership gate. Intakes are created anonymously and keyed by the typed
  -- contact_email (00105), so ownership is the email match — identical to
  -- the leads_select_homeowner USING clause in 00116.
  IF NOT EXISTS (
    SELECT 1
      FROM public.homeowner_intakes hi
     WHERE hi.matched_lead_id = p_lead_id
       AND hi.contact_email IS NOT NULL
       AND lower(hi.contact_email) = v_email
  ) THEN
    RAISE EXCEPTION 'homeowner_message_forbidden: caller owns no intake matched to lead %', p_lead_id
      USING ERRCODE = 'P0001';
  END IF;

  -- `notes` is a newline-delimited transcript whose speaker is decided by
  -- the "[out]" / "[in]" prefix on each line. An unsanitised body carrying
  -- a newline plus a forged "[out]:" prefix would render inside the
  -- homeowner's own thread as a message FROM the contractor — a quote or a
  -- commitment nobody made. Collapse every line break before the line is
  -- assembled, so one call can only ever produce one line.
  v_body := btrim(regexp_replace(coalesce(p_body, ''), E'[\\r\\n]+', ' ', 'g'));

  IF v_body = '' THEN
    RAISE EXCEPTION 'homeowner_message_empty: message body is blank'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'homeowner_message_too_long: % chars exceeds the 4000 char limit', length(v_body)
      USING ERRCODE = 'P0001';
  END IF;

  -- Millisecond ISO-8601 in UTC, byte-compatible with the contractor side's
  -- `new Date().toISOString()` lines and with the parser in both message
  -- pages.
  v_line := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            || ' [in]: ' || v_body;

  -- Read-and-append in one statement. The route used to SELECT notes, build
  -- the new value in JS, then UPDATE — a read-modify-write that silently
  -- drops a contractor message written between the two calls. Composing
  -- inside the UPDATE removes that window.
  UPDATE public.leads l
     SET notes = CASE
                   WHEN l.notes IS NULL OR l.notes = '' THEN v_line
                   ELSE l.notes || E'\n' || v_line
                 END
   WHERE l.id = p_lead_id;

  GET DIAGNOSTICS v_written = ROW_COUNT;

  -- Ownership already proved an intake points at this lead, so a zero here
  -- means the lead row itself is gone (deleted permit cascade). Raise —
  -- returning normally would be the exact silent-success this migration
  -- exists to kill.
  IF v_written <> 1 THEN
    RAISE EXCEPTION 'homeowner_message_not_stored: lead % matched % rows', p_lead_id, v_written
      USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- Homeowners are authenticated users; anon has no business here (an intake
-- can be filed anonymously, but replying to a thread requires an account).
REVOKE EXECUTE ON FUNCTION public.append_homeowner_message(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.append_homeowner_message(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.append_homeowner_message(uuid, text) IS
  'Appends one [in]: line to leads.notes for a homeowner who owns an intake matched to that lead. Only write lane homeowners have on public.leads; see 00116.';

COMMIT;

-- Verify (as an authenticated homeowner, not service_role):
--   SELECT public.append_homeowner_message('<lead-uuid>', 'test');
--   SELECT right(notes, 120) FROM public.leads WHERE id = '<lead-uuid>';
-- Expect the last line to be "<iso-ts> [in]: test".
-- Calling with a lead the caller does not own must raise
-- homeowner_message_forbidden, NOT return quietly.
