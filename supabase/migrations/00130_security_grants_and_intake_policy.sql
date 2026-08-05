-- 00130_security_grants_and_intake_policy.sql
-- 2026-08-05 audit — two HIGH findings, both verified live before writing.
--
-- ════════════════════════════════════════════════════════════════════════
-- (A) anon/authenticated still hold EXECUTE on four SECURITY DEFINER
--     functions, two of which WRITE to core tables.
-- ════════════════════════════════════════════════════════════════════════
--
-- ─── Why the earlier REVOKEs did nothing ────────────────────────────────
-- 00115:117, 00118:90, 00119:30 and 00120:108 each ship the line
--
--     REVOKE EXECUTE ON FUNCTION public.<fn>() FROM PUBLIC;
--
-- and each one is a no-op against the actual grant. Supabase's project
-- bootstrap runs ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS
-- TO anon, authenticated, service_role, so every function created in
-- `public` is born with three PER-ROLE grants. `REVOKE ... FROM PUBLIC`
-- removes only the grant held by the pseudo-role PUBLIC; it does not
-- touch a grant held by a named role. The result, read live from pg_proc
-- on 2026-08-05 (proacl, all four SECURITY DEFINER = true):
--
--   get_covered_states()          | anon=X | authenticated=X | service_role=X
--   refresh_landing_stats()       | anon=X | authenticated=X | service_role=X
--   count_distinct_permit_zips()  | anon=X | authenticated=X | service_role=X
--   repair_objobj_permits(integer)| anon=X | authenticated=X | service_role=X
--
-- ─── Impact ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER means the body runs as the function OWNER (postgres),
-- so RLS and table grants are bypassed inside it. Any unauthenticated
-- visitor holding the publishable anon key — which ships in the browser
-- bundle by design — can POST /rest/v1/rpc/<fn> and:
--
--   • repair_objobj_permits(int)  — WRITES. An arbitrary-size UPDATE over
--     `permits` chosen by the caller. It takes the batch size as a
--     parameter, so the caller picks the cost. CLAUDE.md already records
--     that bulk DML on this table took the database down on 2026-08-04;
--     this exposes that same footgun to the open internet as a one-line
--     denial-of-service against all 2.4M rows.
--   • refresh_landing_stats()     — WRITES the landing_stats cache row and
--     runs the fan-out aggregate. Cheap to call, expensive to serve;
--     a trivial amplification lever on a Free-tier instance.
--   • count_distinct_permit_zips() — read-only, but a 3.6s scan per call
--     (00119:14) with no rate limit above it.
--   • get_covered_states()        — read-only.
--
-- ─── Why revoking is safe ───────────────────────────────────────────────
-- Every legitimate caller runs on the service role, so none of them is
-- affected:
--   • count_distinct_permit_zips() — called once, from
--     src/app/api/cron/refresh-landing-stats/route.ts:154, on the client
--     built by createAdminClient() (same file, :46 + :106).
--   • refresh_landing_stats() / repair_objobj_permits(int) — operator and
--     cron helpers, invoked through the Management API or the admin client.
--   • get_covered_states() — grep over the whole repo returns NO callers at
--     all. It is an orphan from the 2026-08-04 landing-map work, superseded
--     by the 00115 landing_stats cache. It stays in place (dropping a
--     function is not additive) but loses its public reach.
-- No browser/anon code path calls any of the four.
--
-- ─── NOTE FOR FUTURE MIGRATIONS ─────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES fires at CREATE time. `CREATE OR REPLACE
-- FUNCTION` preserves the existing ACL and is therefore safe, but a
-- DROP + CREATE re-mints the function and it comes back with anon and
-- authenticated re-granted. If any of these four is ever dropped and
-- recreated, re-run the DO block below. `REVOKE ... FROM PUBLIC` alone
-- will not do it.
--
-- ════════════════════════════════════════════════════════════════════════
-- (B) 00009_schema_v2.sql:85 — policy intakes_insert_anon has
--     WITH CHECK (true), which self-grants read access to other people's
--     leads.
-- ════════════════════════════════════════════════════════════════════════
--
-- ─── The hole ───────────────────────────────────────────────────────────
-- The policy accepts ANY column values from anon and authenticated,
-- including the two columns that are supposed to be assigned by the
-- matching engine: matched_lead_id and matched_contractor_id.
--
-- 00116:63-75 then added the homeowner read lane on `leads`:
--
--     CREATE POLICY "leads_select_homeowner" ON public.leads
--       FOR SELECT TO authenticated USING (EXISTS (
--         SELECT 1 FROM public.homeowner_intakes hi
--         WHERE hi.matched_lead_id = leads.id
--           AND hi.contact_email IS NOT NULL
--           AND lower(hi.contact_email) = lower(coalesce(auth.jwt()->>'email',''))));
--
-- Ownership of a lead is therefore proven by a row the attacker is allowed
-- to write. Any signed-in account (magic link, no payment, no territory)
-- inserts one intake pointed at a lead it does not own and reads it:
--
--     supabase.from('homeowner_intakes').insert({
--       zip: '33602', trade: 'roofing',
--       contact_email: <own JWT email>,
--       matched_lead_id: <victim lead uuid> })
--     supabase.from('leads').select('*').eq('id', <victim lead uuid>)
--
-- That returns owner_first/owner_last, phone, email, address and score —
-- the enriched contact packet that IS the paid product (wedge contract
-- #1), for a lead belonging to a paying contractor. Repeat per uuid.
-- matched_contractor_id is locked in the same statement because
-- intakes_select_matched (00009:81-83) keys off it, so leaving it writable
-- would let a caller inject rows into a contractor's matched-intake feed.
--
-- ─── Why this does not break the public intake funnel ───────────────────
-- Verified in src/app/api/intake/route.ts before writing. The route builds
-- its client with createAdminClient() (:128) — a deliberate 2026-06-10
-- funnel fix documented at :119-127 — so the insert at :146-173 and the
-- follow-up UPDATE that stamps matched_lead_id at :276-279 both run on the
-- service role. service_role bypasses RLS, and this policy is scoped
-- `TO anon, authenticated`, so it never applies to the real write path.
-- The engine keeps setting both matched_* columns exactly as it does today.
--
-- Nothing else inserts into this table: grep over src/ shows the only
-- .insert() on homeowner_intakes is that one server route. No browser
-- component writes it directly.
--
-- The predicate keeps anonymous submission working (auth.uid() IS NULL —
-- the ordinary portal visitor) and, for a signed-in visitor, pins
-- contact_email to their own JWT email so they cannot plant a row under
-- someone else's address. contact_email IS NULL is still allowed because
-- the intake schema treats contact details as optional (route.ts:21) and
-- a NULL-email row opens no read lane at all — both 00105 and 00116
-- require contact_email IS NOT NULL.
--
-- Idempotent: DO block with to_regprocedure() existence checks +
-- DROP POLICY IF EXISTS / CREATE POLICY. Re-running is a no-op.
-- Rollback is at the bottom of this file.

BEGIN;

-- ── (A) Re-issue the grants that 00115/00118/00119/00120 intended ───────
--
-- REVOKE names PUBLIC *and* both per-role grantees, because the per-role
-- grants are the ones that actually exist (see header). Then hand EXECUTE
-- back to service_role only: all four callers are service-role paths, and
-- the two write helpers must never be reachable from a browser key.
--
-- to_regprocedure() returns NULL rather than raising for a missing
-- function, so this stays safe in an environment where one of them was
-- never applied.
DO $$
DECLARE
  v_sig  text;
  v_sigs text[] := ARRAY[
    -- write helpers — service_role only, no exceptions
    'public.refresh_landing_stats()',
    'public.repair_objobj_permits(int)',
    -- read-only helpers — only caller is the landing-stats refresh, which
    -- runs on the service role, so service_role alone suffices
    'public.count_distinct_permit_zips()',
    'public.get_covered_states()'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE NOTICE '00130: % not present, skipping', v_sig;
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);

    RAISE NOTICE '00130: % locked to service_role', v_sig;
  END LOOP;
END
$$;

-- ── (B) Close the self-granted homeowner read lane ─────────────────────
--
-- Same name, same roles, same purpose as 00009:84-88 — the ONLY change is
-- that WITH CHECK (true) becomes a predicate the attacker cannot satisfy
-- for someone else's lead. Recreated rather than added alongside because
-- INSERT policies OR together: leaving the permissive one in place would
-- keep the hole open.
DROP POLICY IF EXISTS "intakes_insert_anon" ON public.homeowner_intakes;
CREATE POLICY "intakes_insert_anon" ON public.homeowner_intakes
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- Engine-assigned columns. These are what the read lanes key off
    -- (leads_select_homeowner in 00116, intakes_select_matched in 00009),
    -- so a caller that can set them can grant itself access. The real
    -- writer is the service-role route, which bypasses RLS and is
    -- unaffected by this clause.
    matched_lead_id IS NULL
    AND matched_contractor_id IS NULL
    -- Anonymous portal visitor: no JWT, nothing to impersonate.
    AND (
      (SELECT auth.uid()) IS NULL
      -- Signed-in visitor submitting without contact details. Opens no
      -- read lane — 00105 and 00116 both require contact_email IS NOT NULL.
      OR contact_email IS NULL
      -- Signed-in visitor with contact details: must be their own address,
      -- matched case-insensitively exactly as the 00105/00116 read lanes do.
      OR lower(contact_email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
    )
  );

COMMENT ON POLICY "intakes_insert_anon" ON public.homeowner_intakes IS
  'Public homeowner intake lane. matched_lead_id / matched_contractor_id are engine-assigned and must stay NULL on insert: they are the join keys for the homeowner read lanes (00116, 00009), so a writable value is a self-granted read of another contractor''s lead. See 00130.';

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- (A) Restores the exposure described above. Only if a genuine anon or
--     authenticated caller for one of these functions is discovered —
--     in which case prefer routing it through a server route on the
--     service-role client over re-granting a SECURITY DEFINER function.
--
--   GRANT EXECUTE ON FUNCTION public.refresh_landing_stats()        TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.repair_objobj_permits(int)     TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.count_distinct_permit_zips()   TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_covered_states()           TO anon, authenticated;
--
-- (B) Restores 00009:84-88 verbatim. Reopens the lead-exfiltration path;
--     if an insert path legitimately needs to set matched_*, move it onto
--     the service-role client instead of widening this policy.
--
--   DROP POLICY IF EXISTS "intakes_insert_anon" ON public.homeowner_intakes;
--   CREATE POLICY "intakes_insert_anon" ON public.homeowner_intakes
--     FOR INSERT TO anon, authenticated WITH CHECK (true);
