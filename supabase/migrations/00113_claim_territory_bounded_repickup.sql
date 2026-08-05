-- 00113 — bound claim_territory's lead re-pickup so claiming a dense ZIP
-- cannot time out.
--
-- BUG (found 2026-08-04 in a live authenticated walkthrough): clicking
-- "Confirm territories" in onboarding returned 409 "canceling statement due
-- to statement timeout", so NO contractor could claim a territory — a hard
-- launch blocker (onboarding cannot complete).
--
-- ROOT CAUSE: the trailing "lead re-pickup" UPDATE rebinds every unassigned
-- lead in the ZIP from the last 365 days. The plan is fine (bitmap index scan
-- on idx_leads_zip + hash anti-join), but a dense ZIP is simply large — ZIP
-- 06106 alone matches ~12,346 leads. Each updated row carries ~26 index
-- updates plus the record_stage_history() trigger, so the write volume blows
-- past the statement timeout. It is not a planner problem and cannot be fixed
-- with an index.
--
-- FIX: bound the synchronous re-pickup to 500 leads, UNORDERED. The bound
-- alone is not enough — an `ORDER BY score DESC` forces Postgres to scan and
-- sort every matching row before the LIMIT can apply (measured: 4,786 ms on
-- ZIP 06106). Dropping the ordering lets the LIMIT short-circuit the index
-- scan: the same query drops to 2.98 ms, a ~1,600x speedup. The claim then
-- completes in ~3.6 s end-to-end (was a hard timeout).
-- The remaining leads stay contractor_id IS NULL and are picked up by the
-- normal scoring/assignment pass. Nothing is lost — only deferred.
--
-- VERIFIED live 2026-08-04: POST /api/territories {zip:'06106'} returned
-- 201 in 3.58 s and bound 500 leads to the claiming contractor.
--
-- Everything else in the function is byte-for-byte unchanged (tier cap,
-- payment gate, slot allocation, waitlist delete), so this is a safe
-- in-place replace. Re-runnable.

CREATE OR REPLACE FUNCTION public.claim_territory(p_zip character varying, p_contractor_id uuid)
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
  v_sub_id        text;
  v_email         text;
BEGIN
  -- ─── Tier cap + payment enforcement ────────────────────────────────
  SELECT plan, stripe_subscription_id, email
    INTO v_plan, v_sub_id, v_email
    FROM profiles
   WHERE id = p_contractor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tier_cap_exceeded: contractor profile not found' USING ERRCODE = 'P0001';
  END IF;

  -- Payment gate (00106): a subscription id exists only after the Stripe
  -- checkout actually completed (incl. trial start). God-mode accounts are
  -- exempt.
  IF v_sub_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM god_mode_emails g
    WHERE lower(g.email) = lower(coalesce(v_email, ''))
  ) THEN
    RAISE EXCEPTION 'payment_required: complete checkout to claim territories'
      USING ERRCODE = 'P0001';
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

  -- ─── Lead re-pickup (00102) — now BOUNDED + UNORDERED (00113) ──────
  -- Cap the synchronous rebind so a dense ZIP can't time out the claim.
  -- Deliberately NO ORDER BY: sorting would force a full scan of every
  -- matching row before the LIMIT applied (see header). The tail is
  -- rebound by the normal assignment pass.
  WITH cand AS (
    SELECT l.id
      FROM leads l
     WHERE l.contractor_id IS NULL
       AND l.zip = p_zip
       AND l.created_at >= now() - INTERVAL '365 days'
       AND NOT EXISTS (
         SELECT 1 FROM leads d
          WHERE d.permit_id = l.permit_id
            AND d.contractor_id = p_contractor_id
       )
     LIMIT 500
  )
  UPDATE leads l
     SET contractor_id = p_contractor_id
    FROM cand
   WHERE l.id = cand.id;

  GET DIAGNOSTICS v_repicked = ROW_COUNT;
  RAISE NOTICE 'claim_territory: rebound % unassigned leads in ZIP % to %',
    v_repicked, p_zip, p_contractor_id;

  RETURN v_slot;
END;
$function$;
