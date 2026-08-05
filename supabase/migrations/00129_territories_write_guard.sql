-- 00129_territories_write_guard.sql
-- 2026-08-05 audit — CLOSES THE PAYWALL BYPASS ON THE PRODUCT ITSELF.
--
-- ─── The hole ───────────────────────────────────────────────────────────
-- `territories` is what a contractor buys. Its only INSERT policy
-- (00061:65-69, originally 00003:50-52) is:
--
--     CREATE POLICY "territories_insert_own" ON public.territories
--       FOR INSERT TO authenticated
--       WITH CHECK ((SELECT auth.uid()) = contractor_id);
--
-- The sole condition is "the row you insert is yours". RLS gates ROWS, not
-- ENTITLEMENT, and both `anon` and `authenticated` hold INSERT/UPDATE/DELETE
-- on the table. So a free magic-link account can run one line in a browser
-- console and own territory:
--
--     supabase.from('territories').insert({
--       zip: '33602', contractor_id: <own uid>, slot_number: 1, status: 'active'
--     })
--
-- Every gate that is supposed to stop that sits one layer ABOVE the table
-- and is simply skipped by talking to PostgREST directly:
--   • src/app/api/territories/route.ts:78-102 — 402 unless
--     profiles.stripe_subscription_id is present.
--   • src/app/api/territories/route.ts:104-122 — PLAN_ZIP_LIMITS cap.
--   • claim_territory (00113) — the same payment gate and the 3/5/12/20 cap,
--     enforced server-side.
--
-- The payoff is automatic and needs no further action from the attacker.
-- The score cron reads territories with NO entitlement predicate
-- (src/app/api/cron/score/route.ts:970-974:
--   .from("territories").select("zip, contractor_id, profiles!inner(...)")
--   .eq("status","active"))
-- and creates a lead per contractor per ZIP on every run, and
-- `leads_select_own` then lets the attacker read them straight from
-- PostgREST. That is the entire $149-$2,555/mo product for $0.
--
-- It is also an attack on paying customers, not just on revenue. Only three
-- slots exist per ZIP (uq_territories_zip_slot_active, 00003:26-28), so the
-- same loop can squat slots 1-3 across a competitor's ZIPs and deny them the
-- exclusivity that is the reason they pay.
--
-- ─── Why a trigger and not a better policy ──────────────────────────────
-- A policy cannot express "you paid" without reading `profiles`, and the
-- columns it would read (stripe_subscription_id, plan) were themselves
-- self-writable until 00117. Chaining entitlement checks through RLS
-- predicates is how this class of bug keeps coming back. A trigger that
-- refuses ALL non-service writes is unambiguous, and it composes with 00117
-- and 00127 as the same, now-established pattern.
--
-- ─── Why this breaks nothing ────────────────────────────────────────────
-- Verified before writing: `grep -rn 'from("territories")' src/` finds NO
-- .insert / .update / .delete anywhere in the app. Every legitimate write
-- goes through claim_territory or release_territory, both confirmed live as
-- SECURITY DEFINER owned by `postgres`:
--
--   proname           | security_definer | owner
--   claim_territory   | t                | postgres
--   release_territory | t                | postgres
--
-- Inside a SECURITY DEFINER function, `current_user` is the function OWNER,
-- so both RPCs land in the pass-through branch below and keep working
-- unchanged. Cron and webhook writers use the service-role client and pass
-- for the same reason.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER. Re-running is a no-op. Rollback is at the bottom of this file.

BEGIN;

CREATE OR REPLACE FUNCTION public.territories_guard_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_actor text := current_user;
BEGIN
  /* Trusted writers:
       service_role      — src/lib/supabase/admin.ts (crons, webhooks)
       postgres /
       supabase_admin    — migrations, SQL editor, Management API, and
                           critically the SECURITY DEFINER bodies of
                           claim_territory / release_territory, where
                           current_user is the function owner (postgres).

     NOTE for future work: any NEW SECURITY DEFINER function that writes
     territories will also pass this guard, so it must enforce payment and
     the per-plan ZIP cap itself, exactly as claim_territory does. */
  IF v_actor IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'territories is not directly writable; claim and release go through claim_territory()/release_territory()'
    USING ERRCODE = '42501',
          HINT = 'These RPCs enforce the subscription check and the per-plan ZIP cap that a direct write would skip.';
END;
$fn$;

COMMENT ON FUNCTION public.territories_guard_writes() IS
  'Refuses direct end-user DML on territories. Entitlement (payment + per-plan ZIP cap) is enforced in claim_territory(), which RLS alone cannot express. See 00129.';

DROP TRIGGER IF EXISTS territories_guard_writes ON public.territories;
CREATE TRIGGER territories_guard_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.territories
  FOR EACH ROW EXECUTE FUNCTION public.territories_guard_writes();

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Only if a legitimate write path is discovered that runs as the end user.
-- Prefer moving that write into a SECURITY DEFINER RPC over dropping this.
--
--   DROP TRIGGER IF EXISTS territories_guard_writes ON public.territories;
--   DROP FUNCTION IF EXISTS public.territories_guard_writes();
