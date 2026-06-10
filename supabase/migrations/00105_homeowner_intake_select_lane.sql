-- ─────────────────────────────────────────────────────────────────────
-- 00105 · Homeowner SELECT lane on homeowner_intakes.
--
-- 2026-06-10 journey audit: the only SELECT policy on homeowner_intakes
-- was `intakes_select_matched` (matched contractor only), so a signed-in
-- homeowner could NEVER read their own submissions — the /homeowner
-- "My Projects" list was always empty and GET /api/intake/[id] 404'd for
-- the actual owner. Intakes are keyed by typed contact_email (anonymous
-- chat submit), so ownership = JWT email matches contact_email.
--
-- Additive, idempotent. Policies OR together with the contractor lane.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

DROP POLICY IF EXISTS "intakes_select_own_email" ON public.homeowner_intakes;
CREATE POLICY "intakes_select_own_email" ON public.homeowner_intakes
  FOR SELECT TO authenticated
  USING (
    contact_email IS NOT NULL
    AND lower(contact_email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
  );

COMMIT;
