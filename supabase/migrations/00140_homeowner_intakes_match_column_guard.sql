-- 00140_homeowner_intakes_match_column_guard.sql
-- 2026-08-06 audit — closes the UPDATE-side half of the lock 00130 added.
--
-- NOT YET APPLIED. Left on disk deliberately; apply via
-- scripts/_apply-migration-*.mjs (Management API) — `supabase db push` will
-- try to re-apply the whole repo, see the CLI-tracking note in CLAUDE.md.
--
-- ─── The hole ───────────────────────────────────────────────────────────
-- `homeowner_intakes.matched_lead_id` is an access-granting column. Two
-- lanes key off it, and neither is column-scoped:
--
--   • leads_select_homeowner (00116:63-75) — FOR SELECT on `leads` USING
--     EXISTS (... hi.matched_lead_id = leads.id AND lower(hi.contact_email)
--     = lower(auth.jwt()->>'email')). A match grants `select('*')` on the
--     WHOLE lead row: owner name, phone, email, address, score, and the
--     contractor's private `notes`. That is the enriched packet — the thing
--     contractors pay $149-$2,555/mo for.
--   • append_homeowner_message (00121:74-83) — SECURITY DEFINER, GRANTed to
--     `authenticated` (00121:136), gated by a byte-identical predicate. A
--     match therefore also lets the caller write an attacker-authored
--     `[in]:` line into another contractor's CRM notes.
--
-- 00130 recognised this and locked the column on INSERT: its rewritten
-- `intakes_insert_anon` policy requires `matched_lead_id IS NULL AND
-- matched_contractor_id IS NULL`. But the UPDATE policy was never touched.
-- `intakes_update_own_email` (00116:44-53) has USING and WITH CHECK that are
-- byte-identical and constrain only `contact_email`:
--
--     USING      (contact_email IS NOT NULL AND lower(contact_email) = lower(...jwt email))
--     WITH CHECK (contact_email IS NOT NULL AND lower(contact_email) = lower(...jwt email))
--
-- An UPDATE that leaves contact_email alone and sets matched_lead_id
-- satisfies both clauses. So the insert-side lock is undone one statement
-- later:
--
--     supabase.from('homeowner_intakes')
--       .update({ matched_lead_id: '<some lead uuid>' })
--       .eq('id', '<my own intake id>')
--     supabase.from('leads').select('*').eq('id', '<same lead uuid>')
--
-- Every step is reachable. The attacker's own intake is insertable (00130)
-- and readable (intakes_select_own_email, 00105:17-22) so they have the row
-- id, and PostgREST is directly addressable — which 00129 and 00130 both
-- establish for this exact table.
--
-- The policy's own comment at 00116:41-42 concedes the gap ("Column-level
-- restriction is enforced in the route"). Route-level enforcement is not a
-- control when the table is reachable without the route.
--
-- ─── What bounds it, and why that is not a fix ──────────────────────────
-- `matched_lead_id REFERENCES leads(id)` (00031:140), so the attacker needs
-- a real lead uuid rather than an enumerable integer. That caps
-- practicality, not validity — it is the same prerequisite 00130 accepted
-- when it closed the INSERT variant, and lead uuids travel in ordinary
-- channels: /homeowner/messages?thread=<lead_id> URLs (see
-- src/app/(homeowner)/homeowner/intakes/[id]/page.tsx:331), support tickets,
-- screenshots, and any contractor who churns while holding ids for leads
-- that later rebind elsewhere.
--
-- ─── Why a trigger and not a better policy ──────────────────────────────
-- A policy's WITH CHECK cannot reference OLD, so it cannot express "this
-- column did not change" — only "its new value satisfies P". Widening the
-- policy to `matched_lead_id IS NULL` would be worse than the hole: it
-- would break the legitimate withdraw path for every intake that HAS been
-- matched, which is all of them.
--
-- A BEFORE UPDATE trigger is the established shape in this repo for exactly
-- this class: 00117 (profiles billing/trust columns), 00127
-- (contractor_licenses trust columns), 00129 (territories DML), 00135
-- (territory trade). This is the same pattern, fourth application.
--
-- ─── Why this breaks nothing ────────────────────────────────────────────
-- Verified every writer of the two columns before writing:
--
--   src/app/api/intake/route.ts:277-284  — the ONLY writer. Sets
--       matched_lead_id + henri_score after creating the lead. Runs on
--       createAdminClient() (route.ts:3), i.e. `service_role`, which takes
--       the pass-through branch below. Documented as service-role at
--       00130:106-112.
--   src/app/api/quotes/route.ts:127-137 — sets matched_contractor_id on
--       INSERT, not UPDATE. This trigger is BEFORE UPDATE only.
--
-- The only authenticated UPDATE anywhere in src/ is the consent withdrawal
-- at src/app/api/intake/[id]/route.ts:206-212, which writes `status` and
-- `consent_given_at` and touches neither guarded column. It keeps working.
--
-- `henri_score` is deliberately NOT locked: it grants no access and gates no
-- entitlement, so locking it would trade a real behavioural risk for no
-- security gain. Revisit if it ever starts driving routing or pricing.
--
-- ─── Follow-up, deliberately not bundled ────────────────────────────────
-- leads_select_homeowner still returns EVERY column of the matched lead,
-- including the contractor's `notes`. Narrowing it to a column-limited view
-- is the right next step; it changes what the homeowner messaging UI reads
-- and so belongs in its own change with its own verification.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER. Re-running is a no-op. Rollback at the bottom.

BEGIN;

CREATE OR REPLACE FUNCTION public.homeowner_intakes_guard_match_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_actor text := current_user;
BEGIN
  /* Trusted writers:
       service_role        — src/lib/supabase/admin.ts (/api/intake, crons)
       postgres /
       supabase_admin      — migrations, SQL editor, Management API

     NOTE for future work: inside a SECURITY DEFINER function `current_user`
     is the function OWNER, so any new SECURITY DEFINER RPC that is
     EXECUTE-able by `authenticated` and writes these columns would pass
     this guard and must re-check ownership itself. None exists today. */
  IF v_actor IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.matched_lead_id IS DISTINCT FROM OLD.matched_lead_id THEN
    RAISE EXCEPTION
      'homeowner_intakes.matched_lead_id is not user-writable; it is set by the matching engine only'
      USING ERRCODE = '42501',
            HINT = 'This column grants read access to the matched lead (leads_select_homeowner) and write access to its notes (append_homeowner_message). Server code must perform this write with the service-role client.';
  END IF;

  IF NEW.matched_contractor_id IS DISTINCT FROM OLD.matched_contractor_id THEN
    RAISE EXCEPTION
      'homeowner_intakes.matched_contractor_id is not user-writable; it is set by the matching engine only'
      USING ERRCODE = '42501',
            HINT = 'Server code must perform this write with the service-role client (src/lib/supabase/admin.ts).';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.homeowner_intakes_guard_match_columns() IS
  'Refuses end-user UPDATEs to homeowner_intakes.matched_lead_id / matched_contractor_id. RLS gates rows, not columns, and intakes_update_own_email (00116) constrains only contact_email — so the INSERT-side lock added by 00130 was undoable with one UPDATE. See 00140.';

DROP TRIGGER IF EXISTS homeowner_intakes_guard_match_columns ON public.homeowner_intakes;
CREATE TRIGGER homeowner_intakes_guard_match_columns
  BEFORE UPDATE ON public.homeowner_intakes
  FOR EACH ROW EXECUTE FUNCTION public.homeowner_intakes_guard_match_columns();

COMMIT;

-- ─── Verification (run after applying, as an ordinary authenticated user) ─
--   -- own intake, changing only status: expected to SUCCEED
--   update public.homeowner_intakes set status = 'withdrawn' where id = '<own>';
--   -- own intake, re-pointing the match: expected to FAIL with 42501
--   update public.homeowner_intakes set matched_lead_id = '<any lead>' where id = '<own>';
--
-- ─── Rollback ───────────────────────────────────────────────────────────
-- Only if a legitimate end-user writer of these columns is discovered.
-- Prefer moving that write to the service-role client over dropping this.
--
--   DROP TRIGGER IF EXISTS homeowner_intakes_guard_match_columns ON public.homeowner_intakes;
--   DROP FUNCTION IF EXISTS public.homeowner_intakes_guard_match_columns();
