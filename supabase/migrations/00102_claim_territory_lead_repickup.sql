-- ─────────────────────────────────────────────────────────────────────
-- 00102 · Lead re-pickup on territory claim + one-shot backfill.
--
-- Context (2026-06-09 audit): the 2026-05-11 cleanup NULL'd contractor_id
-- on 269,863 leads that had been stamped to the founder during testing.
-- Nothing ever rebinds those rows: the score cron only creates NEW leads
-- for permits in actively-claimed ZIPs, and claiming a territory never
-- touched existing leads. Net effect — a contractor who claims a ZIP with
-- a rich existing lead inventory starts from zero, and the stranded rows
-- are invisible to every user forever (RLS `leads_select_own` + the
-- useLeads contractor filter both require a matching contractor_id).
--
-- Fix: `claim_territory` now rebinds unassigned leads in the claimed ZIP
-- to the claimant, subject to:
--   - contractor_id IS NULL only (never reassigns another contractor's
--     leads — wedge rule: one contractor per permit at a time),
--   - lead created within the last 365 days (stale inventory stays
--     parked rather than flooding a fresh dashboard),
--   - no duplicate (permit_id, contractor_id) pair (the score cron's
--     per-contractor-copy model upserts on that pair; skip permits the
--     claimant already has a lead for).
--
-- Multi-slot note: with up to 3 slots per ZIP, the FIRST claimant absorbs
-- the unassigned backlog; later slot-holders receive per-contractor
-- copies of new permits from the score cron as before. Acceptable
-- Phase-0 semantics — the backlog is a one-time asset.
--
-- Also performs the one-shot backfill for territories that are ALREADY
-- active (they claimed before this function existed). Idempotent: the
-- UPDATE only matches contractor_id IS NULL rows, so re-runs are no-ops.
--
-- Everything from 00088 (tier caps) is preserved verbatim.
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
  v_repicked      int;
BEGIN
  -- ─── Tier cap enforcement (00088, unchanged) ──────────────────────
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

  -- ─── Claim logic (00088, unchanged) ───────────────────────────────
  SELECT slot_number INTO v_existing
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  IF FOUND THEN
    RAISE EXCEPTION 'Contractor already holds an active territory in ZIP %', p_zip;
  END IF;

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

  DELETE FROM zip_waitlist
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id;

  -- ─── Lead re-pickup (NEW in 00102) ────────────────────────────────
  -- Rebind unassigned leads in this ZIP to the claimant. WHERE clause
  -- doubles as the pg-safeupdate guard. The NOT EXISTS prevents a
  -- duplicate (permit_id, contractor_id) pair when the claimant already
  -- received a per-contractor copy of the same permit.
  UPDATE leads l
     SET contractor_id = p_contractor_id
   WHERE l.contractor_id IS NULL
     AND l.zip = p_zip
     AND l.created_at >= now() - INTERVAL '365 days'
     AND NOT EXISTS (
       SELECT 1 FROM leads d
        WHERE d.permit_id = l.permit_id
          AND d.contractor_id = p_contractor_id
     );

  GET DIAGNOSTICS v_repicked = ROW_COUNT;
  RAISE NOTICE 'claim_territory: rebound % unassigned leads in ZIP % to %',
    v_repicked, p_zip, p_contractor_id;

  RETURN v_slot;
END;
$function$;

COMMENT ON FUNCTION public.claim_territory(character varying, uuid) IS
  '00102 - ZIP claim with per-tier cap (00088) + lead re-pickup: rebinds contractor_id-IS-NULL leads in the claimed ZIP (<=365d old, no duplicate permit pair) to the claimant.';

-- ─── One-shot backfill for territories active BEFORE this migration ──
-- Same predicate as the in-function re-pickup, applied to every active
-- territory. Idempotent: only contractor_id IS NULL rows match.
UPDATE leads l
   SET contractor_id = t.contractor_id
  FROM territories t
 WHERE t.status = 'active'
   AND l.contractor_id IS NULL
   AND l.zip = t.zip
   AND l.created_at >= now() - INTERVAL '365 days'
   AND NOT EXISTS (
     SELECT 1 FROM leads d
      WHERE d.permit_id = l.permit_id
        AND d.contractor_id = t.contractor_id
   );

COMMIT;
