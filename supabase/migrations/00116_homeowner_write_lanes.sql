-- ─────────────────────────────────────────────────────────────────────
-- 00116 · Homeowner write lanes: consent withdrawal + message threads.
--
-- 2026-08-04 API audit found two homeowner-facing features that are
-- structurally dead because RLS admits no homeowner lane. In both cases
-- the table-level GRANT to `authenticated` is present, so the statements
-- execute, RLS narrows the target set to zero rows, PostgREST returns
-- 204, and supabase-js yields {data:null, error:null} — a SILENT no-op
-- that the routes then report to the user as success.
--
--   1. CONSENT WITHDRAWAL (privacy obligation).
--      PATCH /api/intake/[id] sets status='withdrawn' + consent_given_at=NULL.
--      homeowner_intakes has only three policies — intakes_insert_anon (a),
--      intakes_select_matched (r), intakes_select_own_email (r). No UPDATE.
--      A homeowner who revokes permission to be contacted is told in plain
--      language that pending outreach was cancelled. Nothing is revoked:
--      checkOutreachAllowed() keeps returning allowed and the contractor
--      keeps calling and texting. TCPA-facing.
--
--   2. HOMEOWNER MESSAGE THREADS.
--      /api/homeowner/messages reads and appends to leads.notes. public.leads
--      has four policies, all contractor- or service-role-scoped, so every
--      thread is filtered out and the Messages tab is permanently empty for
--      every matched homeowner.
--
-- Ownership predicate mirrors 00105: intakes are created anonymously and
-- keyed by typed contact_email, so ownership = JWT email matches
-- contact_email (case-insensitive).
--
-- Additive and idempotent. Policies OR together with the existing
-- contractor and god-mode lanes; no existing policy is modified or
-- dropped, so contractor access is unchanged.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Homeowners may update their own intake ────────────────────────
--
-- Scoped by the same email predicate as the 00105 SELECT lane. WITH CHECK
-- repeats USING so a homeowner cannot re-key a row onto someone else's
-- email. Column-level restriction is enforced in the route (it writes only
-- status + consent_given_at); this policy governs row visibility.
DROP POLICY IF EXISTS "intakes_update_own_email" ON public.homeowner_intakes;
CREATE POLICY "intakes_update_own_email" ON public.homeowner_intakes
  FOR UPDATE TO authenticated
  USING (
    contact_email IS NOT NULL
    AND lower(contact_email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
  )
  WITH CHECK (
    contact_email IS NOT NULL
    AND lower(contact_email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
  );

-- ── 2. Homeowners may read the lead their intake produced ────────────
--
-- Reachable only through an intake the caller owns. Deliberately SELECT-only:
-- the write path stays contractor-scoped. Appending a homeowner message
-- should go through a SECURITY DEFINER RPC that can only append to `notes`,
-- rather than a broad UPDATE policy that would expose every contractor-owned
-- column on the row. That RPC is intentionally NOT created here — see the
-- follow-up note at the bottom of this file.
DROP POLICY IF EXISTS "leads_select_homeowner" ON public.leads;
CREATE POLICY "leads_select_homeowner" ON public.leads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homeowner_intakes hi
      WHERE hi.matched_lead_id = leads.id
        AND hi.contact_email IS NOT NULL
        AND lower(hi.contact_email)
            = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- FOLLOW-UP still required for homeowner messaging to fully work
-- (deliberately out of scope for this migration):
--
--   a. Contractor display name. public.profiles has a single SELECT policy
--      (profiles_select_own, auth.uid() = id), so a homeowner cannot read
--      the matched contractor's row. GET /api/homeowner/messages will fall
--      back to "Your contractor" for every thread until either a narrow
--      SELECT lane exists (id = the intake's matched_contractor_id, limited
--      to company_name / full_name) or the name is resolved from a view.
--
--   b. Message send path. POST /api/homeowner/messages appends to
--      leads.notes; leads_update_own is contractor-scoped, so the write
--      still cannot land. Prefer:
--        CREATE FUNCTION public.append_homeowner_message(p_lead_id uuid, p_body text)
--          RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
--        -- verifies the caller owns an intake with matched_lead_id = p_lead_id,
--        -- then appends one line to notes and nothing else.
--      over an UPDATE policy on leads.
-- ─────────────────────────────────────────────────────────────────────
