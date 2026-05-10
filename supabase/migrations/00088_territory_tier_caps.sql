-- ─────────────────────────────────────────────────────────────────────
-- 00088 · Server-side per-tier ZIP cap on `claim_territory`.
--
-- Module 2 of the 18-module enhancement plan (2026-05-09 plan §9.2).
--
-- Before this migration the cap (3/5/12/20 ZIPs per tier) lived only in
-- Stripe metadata + UI hints. A founder-tier contractor at $149/mo could
-- legally claim 50 ZIPs because no server-side gate enforced the cap.
-- This migration closes the loophole.
--
-- Caps:
--   free        →  0 ZIPs (cannot claim — must upgrade)
--   founder     →  3 ZIPs
--   starter     →  5 ZIPs
--   pro         → 12 ZIPs
--   enterprise  → 20 ZIPs
--
-- Behavior preservation:
--   - Existing 3-slot-per-ZIP rule unchanged (max 3 contractors per ZIP).
--   - Existing duplicate-claim-by-same-contractor check unchanged.
--   - Existing zip_waitlist cleanup on success unchanged.
--   - Return type still `int` (slot number on success).
--
-- New behavior:
--   - Reads profiles.plan for the calling contractor.
--   - Counts that contractor's existing active claims.
--   - Raises with a structured ERRCODE 'P0001' + message starting with
--     'tier_cap_exceeded:' so the UI can map to an upgrade CTA.
--
-- Idempotent: CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_territory(
  p_zip          character varying,
  p_contractor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot          int;
  v_existing      int;
  v_plan          plan_type;
  v_cap           int;
  v_active_count  int;
BEGIN
  -- ─── Tier cap enforcement (NEW) ───────────────────────────────────
  SELECT plan INTO v_plan
    FROM profiles
   WHERE id = p_contractor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tier_cap_exceeded: contractor profile not found' USING ERRCODE = 'P0001';
  END IF;

  v_cap := CASE v_plan
    WHEN 'free'       THEN 0
    WHEN 'founder'    THEN 3
    WHEN 'starter'    THEN 5
    WHEN 'pro'        THEN 12
    WHEN 'enterprise' THEN 20
    ELSE 0
  END;

  IF v_cap = 0 THEN
    RAISE EXCEPTION 'tier_cap_exceeded: plan % does not allow territory claims', v_plan
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_active_count
    FROM territories
   WHERE contractor_id = p_contractor_id
     AND status = 'active';

  IF v_active_count >= v_cap THEN
    RAISE EXCEPTION 'tier_cap_exceeded: % plan allows % ZIPs, % already claimed', v_plan, v_cap, v_active_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── Existing logic preserved verbatim ────────────────────────────
  -- Prevent duplicate active claims by the same contractor in this ZIP
  SELECT slot_number INTO v_existing
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  IF FOUND THEN
    RAISE EXCEPTION 'Contractor already holds an active territory in ZIP %', p_zip;
  END IF;

  -- Find the lowest available slot (1, 2, or 3)
  SELECT s.n INTO v_slot
    FROM (VALUES (1),(2),(3)) AS s(n)
   WHERE NOT EXISTS (
     SELECT 1 FROM territories
      WHERE zip = p_zip
        AND slot_number = s.n
        AND status = 'active'
   )
   ORDER BY s.n
   LIMIT 1
   FOR UPDATE;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'All 3 slots are taken for ZIP %', p_zip;
  END IF;

  INSERT INTO territories (zip, contractor_id, status, slot_number, claimed_at)
  VALUES (p_zip, p_contractor_id, 'active', v_slot, now());

  -- Remove from waitlist if they were waiting
  DELETE FROM zip_waitlist
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id;

  RETURN v_slot;
END;
$function$;

COMMENT ON FUNCTION public.claim_territory(character varying, uuid) IS
  '00088 - Server-side ZIP claim with per-tier cap (3/5/12/20). Raises ERRCODE P0001 with message prefix `tier_cap_exceeded:` when the contractor exceeds their plan cap. UI maps this to an upgrade CTA.';

COMMIT;
