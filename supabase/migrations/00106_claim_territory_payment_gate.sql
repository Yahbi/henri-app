-- ─────────────────────────────────────────────────────────────────────
-- 00106 · Payment gate inside claim_territory (defense in depth).
--
-- 2026-06-10 audit: the onboarding flow gated territory claims on
-- `stripe_customer_id`, which is stamped when a checkout SESSION is
-- created — before any payment. A user who cancelled at the Stripe page
-- could claim ZIPs and use the dashboard with a self-asserted plan.
-- The app route now checks `stripe_subscription_id` (written only by the
-- checkout.session.completed webhook), but `claim_territory` itself is
-- SECURITY DEFINER with EXECUTE granted to `authenticated`, i.e. callable
-- directly via PostgREST by any signed-in user — so the REAL gate must
-- live here.
--
-- Exemption: god_mode_emails (00103) — founder/dev preview accounts.
--
-- Body is the 00102 version (tier caps + lead re-pickup) plus the
-- payment check. Idempotent (CREATE OR REPLACE).
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

  -- Payment gate (NEW in 00106): a subscription id exists only after the
  -- Stripe checkout actually completed (incl. trial start). God-mode
  -- accounts are exempt.
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

  -- ─── Lead re-pickup (00102, unchanged) ─────────────────────────────
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
  '00106 - ZIP claim with payment gate (stripe_subscription_id required unless god-mode) + per-tier cap (00088) + lead re-pickup (00102).';

COMMIT;
