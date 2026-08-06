-- 00135_territory_one_per_trade.sql
-- 2026-08-06 — make the backend enforce the exclusivity the product promises.
--
-- ─── The gap ────────────────────────────────────────────────────────────
-- Henri's wedge is exclusivity, and the marketing copy said "one contractor
-- per trade per ZIP". The backend said something else entirely:
--
--   * claim_territory (00088 -> 00106 -> 00113) allocates one of THREE slots
--     per ZIP and only raises when all three are taken.
--   * `trade` is never read. Three roofers could hold the same ZIP, and a
--     roofer could be blocked from a ZIP by two plumbers and a painter.
--
-- CLAUDE.md flagged this as an open product decision. The founder decided on
-- 2026-08-06: one contractor per trade per ZIP. The backend moves to the
-- promise, not the reverse.
--
-- ─── Why `territories.trade` is denormalized ────────────────────────────
-- The claim could read `profiles.trade` on every check, but then the rule
-- would live only inside the function: nothing would stop a direct INSERT,
-- and the constraint could not be expressed in the schema at all. A stored
-- trade lets a partial UNIQUE INDEX enforce it in the database, which is the
-- same belt-and-braces shape used for the payment gate (app check in
-- api/territories + RAISE in the RPC).
--
-- It also freezes the trade AT CLAIM TIME, which is the correct semantics: a
-- contractor who later switches trade must not silently take over a different
-- trade's exclusive ZIP.
--
-- ─── Why slot_number survives ───────────────────────────────────────────
-- slot_number is load-bearing for the existing schema (it is NOT NULL and the
-- 00088 allocator assumes at most one active row per (zip, slot_number)).
-- Rather than drop it and risk a constraint nobody remembers, the allocator
-- keeps assigning the lowest free slot — the ceiling just rises from 3 to 10,
-- one per value of `trade_type`, so the slot can never be the binding limit.
-- Real exclusivity is now the (zip, trade) index below.
--
-- ─── Safety ─────────────────────────────────────────────────────────────
-- 10 active territories exist, all held by dev-contractor@henri.local across
-- 9 Tampa ZIPs, all trade 'general'. The backfill cannot collide.
-- Additive and idempotent. Rollback at the bottom.

BEGIN;

-- ── 1. store the trade the territory was claimed for ────────────────────
ALTER TABLE public.territories
  ADD COLUMN IF NOT EXISTS trade public.trade_type;

COMMENT ON COLUMN public.territories.trade IS
  'Trade this territory grants exclusivity for, frozen at claim time from profiles.trade. One active row per (zip, trade) — see idx_territories_one_per_trade. Denormalized deliberately so the rule is enforceable by the schema and not only inside claim_territory. See 00135.';

-- Backfill from the owning profile. COALESCE to 'general' so a profile with
-- no trade set still produces a usable row rather than a NULL that the unique
-- index would not constrain (NULLs are distinct in Postgres, so a NULL trade
-- would silently opt out of exclusivity).
UPDATE public.territories t
   SET trade = COALESCE(p.trade, 'general'::public.trade_type)
  FROM public.profiles p
 WHERE p.id = t.contractor_id
   AND t.trade IS NULL;

-- Any territory whose profile vanished still needs a value.
UPDATE public.territories
   SET trade = 'general'::public.trade_type
 WHERE trade IS NULL;

ALTER TABLE public.territories
  ALTER COLUMN trade SET DEFAULT 'general'::public.trade_type;

-- ── 2. the actual exclusivity guarantee ─────────────────────────────────
-- PARTIAL on status='active': a released territory must not block a re-claim,
-- and the table keeps released rows for history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_territories_one_per_trade
  ON public.territories (zip, trade)
  WHERE status = 'active';

-- ── 3. claim_territory: reject a ZIP already held for the same trade ────
CREATE OR REPLACE FUNCTION public.claim_territory(
  p_zip character varying,
  p_contractor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_trade         trade_type;
  v_holder        uuid;
BEGIN
  SELECT p.plan, p.stripe_subscription_id, p.email,
         COALESCE(p.trade, 'general'::trade_type)
    INTO v_plan, v_sub_id, v_email, v_trade
    FROM profiles p
   WHERE p.id = p_contractor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tier_cap_exceeded: contractor profile not found' USING ERRCODE = 'P0001';
  END IF;

  -- ─── Payment gate (00106, unchanged) ──────────────────────────────
  -- stripe_subscription_id is written only by the Stripe webhook, so it is
  -- the one field that proves checkout actually completed (incl. trial
  -- start). God-mode accounts are exempt.
  IF v_sub_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM god_mode_emails g
    WHERE lower(g.email) = lower(coalesce(v_email, ''))
  ) THEN
    RAISE EXCEPTION 'payment_required: complete checkout to claim territories'
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── Tier ZIP caps (00088, unchanged) ─────────────────────────────
  v_cap := CASE v_plan
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

  -- ─── Already held by this contractor ──────────────────────────────
  SELECT slot_number INTO v_existing
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  IF FOUND THEN
    RAISE EXCEPTION 'Contractor already holds an active territory in ZIP %', p_zip;
  END IF;

  -- ─── ONE CONTRACTOR PER TRADE PER ZIP (00135) ─────────────────────
  -- This replaces "all 3 slots are taken" as the real limit. A different
  -- trade in the same ZIP is explicitly allowed — that is the product: a
  -- roofer and a plumber can both hold 33607, a second roofer cannot.
  --
  -- Checked here as well as by idx_territories_one_per_trade so the caller
  -- gets an intelligible message instead of a raw unique-violation. The index
  -- remains the authority under concurrency.
  SELECT contractor_id INTO v_holder
    FROM territories
   WHERE zip = p_zip
     AND trade = v_trade
     AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'zip_taken_for_trade: ZIP % is already held by another % contractor', p_zip, v_trade
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── Slot allocation ──────────────────────────────────────────────
  -- Ceiling raised 3 -> 10 (one per trade_type value) so the slot is never
  -- what blocks a claim; (zip, trade) is. Still the lowest free slot, so any
  -- existing (zip, slot_number) uniqueness continues to hold.
  SELECT s.n INTO v_slot
    FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) AS s(n)
   WHERE NOT EXISTS (
     SELECT 1 FROM territories
      WHERE zip = p_zip
        AND slot_number = s.n
        AND status = 'active'
   )
   ORDER BY s.n
   LIMIT 1;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'All slots are taken for ZIP %', p_zip;
  END IF;

  INSERT INTO territories (zip, contractor_id, status, slot_number, trade, claimed_at)
  VALUES (p_zip, p_contractor_id, 'active', v_slot, v_trade, now());

  DELETE FROM zip_waitlist
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id;

  -- ─── Lead re-pickup (00102, bounded by 00113) ─────────────────────
  -- Cap the synchronous rebind so a dense ZIP can't time out the claim.
  -- Deliberately NO ORDER BY: sorting would force a full scan of every
  -- matching row before the LIMIT applied. The tail is rebound by the
  -- normal assignment pass.
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

REVOKE EXECUTE ON FUNCTION public.claim_territory(character varying, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_territory(character varying, uuid) TO authenticated;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Restores the 3-slot, trade-blind behaviour from 00113.
--   DROP INDEX IF EXISTS public.idx_territories_one_per_trade;
--   ALTER TABLE public.territories DROP COLUMN IF EXISTS trade;
--   -- then re-apply supabase/migrations/00113_claim_territory_bounded_repickup.sql
