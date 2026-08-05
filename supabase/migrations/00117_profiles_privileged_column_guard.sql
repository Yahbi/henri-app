-- 00117_profiles_privileged_column_guard.sql
-- 2026-08-04 audit — CLOSES A PAYWALL BYPASS.
--
-- ─── The hole ───────────────────────────────────────────────────────────
-- `profiles` has exactly one UPDATE policy (00061:50-54):
--
--     CREATE POLICY "profiles_update_own" ON public.profiles
--       FOR UPDATE
--       USING  ((SELECT auth.uid()) = id)
--       WITH CHECK ((SELECT auth.uid()) = id);
--
-- RLS policies gate ROWS, not COLUMNS. `authenticated` (and `anon`) hold
-- UPDATE on all 47 columns, and the browser genuinely talks to PostgREST
-- directly (src/app/onboarding/plan/page.tsx and
-- src/app/onboarding/territory/page.tsx both `.from("profiles").update(...)`
-- from a browser client). So any signed-in user can run this from the
-- browser console and grant themselves the product for free:
--
--     supabase.from('profiles')
--       .update({ stripe_subscription_id: 'sub_x', plan: 'enterprise' })
--
-- Both payment gates read exactly those self-writable columns:
--   • src/app/api/territories/route.ts:88-102 — 402 unless
--     `stripe_subscription_id` is present, then `plan` picks the ZIP cap.
--   • claim_territory (00113:50-78) — RAISEs 'payment_required' unless
--     `stripe_subscription_id` is set, then derives the 3/5/12/20 cap
--     from `plan`.
--
-- Impact: a user who never entered a card can lock 20 exclusive ZIPs away
-- from paying contractors (the product's core promise), and a paying
-- Founder ($149 / 3 ZIPs) can self-escalate to Enterprise (20 ZIPs).
-- Nothing self-heals: /api/cron/billing-sync throws on the forged
-- subscription id and only logs the error, so `plan` is never corrected.
--
-- ─── The second, worse vector on the same hole ───────────────────────────
-- claim_territory (00113:62-65) exempts god-mode operators by matching
-- `profiles.email` against `god_mode_emails`:
--
--     IF v_sub_id IS NULL AND NOT EXISTS (
--       SELECT 1 FROM god_mode_emails g
--       WHERE lower(g.email) = lower(coalesce(v_email, ''))
--     ) THEN ... RAISE 'payment_required'
--
-- `profiles.email` is self-writable too, so setting it to a founder
-- address bypasses the payment gate outright — no forged Stripe id
-- needed. `email` is therefore locked here as hard as the billing
-- columns.
--
-- ─── Why a trigger and not column grants ────────────────────────────────
-- `REVOKE UPDATE (col) ... FROM authenticated` is the other standard fix,
-- but it is all-or-nothing per column: it cannot express "the onboarding
-- plan picker may set `plan` only before a subscription exists". Several
-- protected columns have a legitimate authenticated writer today (see the
-- per-column notes below), so this migration uses a BEFORE UPDATE trigger
-- that raises on ESCALATING writes while leaving the legitimate paths
-- intact. Column grants can be layered on later once every write has
-- moved to the service-role client — the trigger stays correct either way.
--
-- ─── Cost ───────────────────────────────────────────────────────────────
-- One `to_jsonb(NEW)`/`to_jsonb(OLD)` pair per UPDATE on `profiles`.
-- `profiles` holds one row per account and is written a handful of times
-- per session; this is not on any hot path. The jsonb comparison also
-- makes the guard tolerant of columns that don't exist in a given
-- environment (both sides read as SQL NULL → not distinct → no raise),
-- so the migration is safe to apply against older branches.
--
-- ─── Idempotency ────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- Re-running is a no-op. Rollback is at the bottom of this file.

BEGIN;

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  /* Columns no end-user session may EVER change. Every one of these is
     either an entitlement gate, an identity anchor, or a trust signal
     rendered to third parties — and none of them has an authenticated
     writer in src/ today, so locking them breaks nothing.

       stripe_subscription_id  THE payment gate (402 in /api/territories,
                               RAISE in claim_territory). Written only by
                               the Stripe webhook via the service-role
                               admin client.
       trial_ends_at           Trial window. Webhook-only.
       email                   Matched against god_mode_emails inside
                               claim_territory — see the header note.
       id, created_at          Identity anchors for the RLS predicate.
       licensed_until          License gate read by DashboardTopBar and
                               /api/compliance/verify. No writer in src/;
                               a self-set value fakes an active license.
       verified_at,
       badge_licensed,
       badge_insured,
       badge_background        Trust badges rendered on the PUBLIC
                               marketplace profile
                               (src/app/(marketing)/contractors/[id]).
                               Read-only in the app — a contractor could
                               self-award "Licensed / Insured / Background
                               checked" to homeowners.
       avg_rating, review_count,
       jobs_completed,
       response_time_h         Public reputation numbers, also read-only
                               in the app. Self-set values would be
                               fabricated stats shown to homeowners.
       referred_by             Referral attribution; drives the payout in
                               webhooks/stripe/route.ts:435-544. */
  c_locked constant text[] := ARRAY[
    'id',
    'email',
    'created_at',
    'stripe_subscription_id',
    'trial_ends_at',
    'licensed_until',
    'verified_at',
    'badge_licensed',
    'badge_insured',
    'badge_background',
    'avg_rating',
    'review_count',
    'jobs_completed',
    'response_time_h',
    'referred_by'
  ];
  v_actor text := current_user;
  v_old   jsonb;
  v_new   jsonb;
  v_col   text;
BEGIN
  /* Trusted DB roles pass straight through:
       service_role     — Stripe webhook, crons, /api/dev/auto-login, and
                          every other caller of src/lib/supabase/admin.ts
       postgres /
       supabase_admin   — migrations, the SQL editor, the Management API
       supabase_auth_admin — GoTrue's own bookkeeping

     NOTE for future work: `current_user` inside a SECURITY DEFINER
     function is the function OWNER, so any SECURITY DEFINER RPC that is
     EXECUTE-able by `authenticated` and writes `profiles` would bypass
     this guard. None exists today (00111/00112 revoked the RPC surface);
     if one is added, it must re-check entitlement itself. */
  IF v_actor IN ('service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  /* ── Hard-locked columns ──────────────────────────────────────────── */
  FOREACH v_col IN ARRAY c_locked LOOP
    IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
      RAISE EXCEPTION
        'profiles.% is not user-writable; this column is set by verified billing/trust events only', v_col
        USING ERRCODE = '42501',
              HINT = 'Server code must perform this write with the service-role client (src/lib/supabase/admin.ts).';
    END IF;
  END LOOP;

  /* ── stripe_customer_id: first claim only ─────────────────────────────
     /api/checkout:52-56 and /api/billing/extra-zip:56-60 legitimately
     stamp a freshly-created Stripe customer onto the row (both guarded by
     `if (!customerId)`), so NULL → value must keep working. Overwriting
     or clearing an existing id is never legitimate: it would repoint
     billing at a customer the user does not own, and the Stripe webhook
     resolves profiles BY this column
     (`.eq("stripe_customer_id", customerId)`). */
  IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     AND OLD.stripe_customer_id IS NOT NULL THEN
    RAISE EXCEPTION
      'profiles.stripe_customer_id cannot be changed once set'
      USING ERRCODE = '42501';
  END IF;

  /* ── plan: only before a subscription exists ──────────────────────────
     The onboarding plan picker (src/app/onboarding/plan/page.tsx:158)
     writes `plan` from the browser BEFORE checkout. That write grants
     nothing on its own — the payment gate ahead of it still requires
     `stripe_subscription_id`, which is hard-locked above — so it stays
     allowed. Once a subscription EXISTS, `plan` is the ZIP-cap input and
     self-escalation (founder 3 → enterprise 20) is the exact abuse this
     migration exists to stop.

     KNOWN INTERACTION: /api/billing/change-plan:133 does
     `.update({ plan })` on a subscribed contractor from the user's own
     session, so it now raises. That call does not check its error
     (`await supabase...update(...)` with no destructure), so the route
     still returns 200 and the `customer.subscription.updated` webhook
     writes the correct plan through the admin client moments later —
     degradation is a brief stale plan pill, not a failure. FOLLOW-UP:
     move that one write to the service-role client for immediate
     consistency. */
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND OLD.stripe_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION
      'profiles.plan cannot be changed directly while a subscription is active'
      USING ERRCODE = '42501',
            HINT = 'Change plans through /api/billing/change-plan so Stripe stays authoritative.';
  END IF;

  /* ── role: no self-promotion to admin ─────────────────────────────────
     Two legitimate authenticated transitions exist and both stay open:
     homeowner → contractor (/api/profile/upgrade-to-contractor:53-60) and
     the dev-only role flip (/api/dev/switch-role, NODE_ENV-gated). Both
     land inside the pair below. `role` also carries 'admin' in its CHECK
     constraint (00010:7); nothing in src/ grants on it today, but a
     self-assignable admin role is a standing escalation primitive. */
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role::text NOT IN ('contractor', 'homeowner') THEN
    RAISE EXCEPTION
      'profiles.role may only be set to contractor or homeowner'
      USING ERRCODE = '42501';
  END IF;

  /* DELIBERATELY LEFT WRITABLE — documented so the next reader doesn't
     assume they were missed:

       full_name, company_name, phone, bio, trade, specialties,
       years_experience, service_area, portfolio_photos, profile_public,
       address, city, state, zip, notification_prefs, capacity_prefs,
       outreach_auto_fire, twilio_tracked_number, review_links,
       insurance_expiry, tutorial_completed_at
         — the legitimate self-service surface (/api/profile
           UPDATABLE_FIELDS, Settings). Untouched, by design.

       license_state, license_number
         — user-declared during onboarding
           (src/app/onboarding/license/page.tsx:237-241) and cross-checked
           server-side against state_license_rosters. The gate that
           matters is `licensed_until`, which IS locked.

       last_license_verified_at, last_compliance_check_at
         — audit timestamps written by /api/licenses/verify:55 and
           /api/compliance/verify:77 from the user's own session. They
           record that a check ran; they are not entitlements.

       onboarding_completed
         — written by the browser at
           src/app/onboarding/territory/page.tsx:455. Only drives
           middleware step-gating; grants no paid access.

       pending_plan, pending_plan_effective_at
         — display-only today (written by /api/billing/change-plan:116-119
           on a scheduled downgrade, cleared by the webhook). Nothing
           reads them for entitlement. ADD THEM TO c_locked the moment the
           "flip plan to pending_plan" cron described in 00026 ships,
           because at that point they become a delayed plan escalation. */

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.profiles_guard_privileged_columns() IS
  'BEFORE UPDATE guard on public.profiles. RLS gates rows, not columns, so '
  'the profiles_update_own policy (00061) let any authenticated user PATCH '
  'their own billing/trust columns via PostgREST and grant themselves paid '
  'access. Raises 42501 (PostgREST -> HTTP 403) when a non-service-role '
  'session changes a protected column. See 00117 for the full column map.';

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;

/* Fires before `profiles_updated_at` (moddatetime) by name ordering, so a
   rejected write never bumps updated_at. FOR EACH ROW + WHEN-less because
   the column set is resolved dynamically inside the function. */
CREATE TRIGGER profiles_guard_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_privileged_columns();

COMMIT;

-- ─── Verification (run as an ordinary signed-in user, NOT service role) ──
--   -- should raise 42501:
--   update public.profiles set stripe_subscription_id = 'sub_forged' where id = auth.uid();
--   update public.profiles set email = 'y.abismuth@gmail.com'         where id = auth.uid();
--   update public.profiles set badge_licensed = true                  where id = auth.uid();
--   -- should raise 42501 only when a subscription already exists:
--   update public.profiles set plan = 'enterprise'                    where id = auth.uid();
--   -- should still succeed:
--   update public.profiles set full_name = 'Test', phone = '+15555550123' where id = auth.uid();
--
-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_guard_privileged_columns();
-- (Reverting restores the bypass — prefer narrowing c_locked over dropping
-- the trigger if a legitimate write turns out to be blocked.)
