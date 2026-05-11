-- 00097_leads_contractor_id_nullable.sql
--
-- Drops the NOT NULL constraint on `public.leads.contractor_id`.
--
-- ## Why
--
-- The wedge schema (migration 00005) modeled `leads` as "scored
-- permits already claimed by a contractor" — every lead row was
-- guaranteed to have a contractor. The score cron only INSERTs lead
-- rows when there's a contractor in the permit's ZIP; permits in
-- unclaimed ZIPs are simply skipped (no lead row created). Under that
-- invariant, `contractor_id NOT NULL` makes sense.
--
-- The invariant has since broken in practice. A 2026-05-11 audit found
-- 269,863 leads stamped with the founder's `contractor_id`, but the
-- founder owns 0 territories — likely a residue from a prior testing
-- phase where the founder claimed many ZIPs, those territories were
-- cleaned up to 9, and the leads kept the stale assignment. Net effect:
-- when a real contractor signs up and claims any of those 269k orphan
-- ZIPs, they won't see the historical leads — the founder still "owns"
-- them. Wedge integrity is technically held ("one contractor per permit
-- per trade") but by the wrong contractor.
--
-- Making `contractor_id` nullable allows the stale assignments to be
-- detached without deleting rows. Real contractors claiming those ZIPs
-- get a clean re-pickup path (score cron / lead-fetcher can find leads
-- where `contractor_id IS NULL` and the ZIP matches the contractor's
-- territory).
--
-- ## Impact analysis
--
-- - INSERT path (score cron): unchanged — still always sets contractor_id.
-- - SELECT path (contractor dashboards): `WHERE contractor_id = $X`
--   naturally excludes NULL rows. No reader breaks.
-- - RLS policy on `leads`: existing policies key on `auth.uid() =
--   contractor_id`. With contractor_id=NULL, the policy returns false
--   (NULL ≠ uid), so NULL-contractor leads are invisible to every
--   contractor account. That's the correct security posture — only
--   reachable via service-role queries or after re-assignment.
-- - Unique constraint on (permit_id, contractor_id): Postgres treats
--   NULL as distinct in unique indexes, so multiple NULL-contractor
--   leads per permit are allowed (matches the new semantics — until a
--   contractor claims, the lead is "in limbo" with no owner).
-- - FK `contractor_id REFERENCES profiles(id)`: NULL is always
--   permitted under FK constraints.
--
-- ## Rollback
--
-- After re-populating all NULL contractor_ids with real owners:
--   ALTER TABLE public.leads
--     ALTER COLUMN contractor_id SET NOT NULL;
--
-- Idempotent — re-applies cleanly via `IF EXISTS` semantics in PG 16+.

BEGIN;

ALTER TABLE public.leads
  ALTER COLUMN contractor_id DROP NOT NULL;

COMMENT ON COLUMN public.leads.contractor_id IS
  '00097 - Now nullable. NULL means the lead exists (permit was scored) but no contractor has claimed the ZIP yet. Re-pickup happens when a contractor claims a territory containing the lead''s ZIP — the lead-fetcher / score cron then sets contractor_id to the new claimant.';

COMMIT;
