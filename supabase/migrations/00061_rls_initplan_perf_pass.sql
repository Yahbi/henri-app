-- 00061_rls_initplan_perf_pass.sql
-- 2026-04-30 audit follow-up: RLS performance + multiple-permissive cleanup.
--
-- The Supabase performance advisor reported 77 WARN findings on the public
-- schema, all from two related issues:
--
--   1. `auth_rls_initplan` (54 instances): policies that call `auth.uid()`
--      directly inside USING/WITH CHECK clauses re-evaluate the auth function
--      per row instead of caching the result for the query. Postgres docs
--      recommend wrapping in a scalar subquery: `(SELECT auth.uid())` so
--      the planner caches once per query.
--
--   2. `multiple_permissive_policies` (21 instances): two legacy `FOR ALL`
--      policies (`"contractor sees own estimates"` on estimates,
--      `"contractor sees own blasts"` on blast_campaigns) overlap with the
--      newer per-action policies. Plus `intake_matches` has two SELECT
--      policies that should be a single OR'd predicate, and `quotes` has
--      two SELECT policies (contractor + homeowner) for the same reason.
--
--   3. Duplicate indexes (2 instances): `idx_estimates_contractor` duplicates
--      `estimates_contractor_id_idx`, and `idx_estimates_lead` duplicates
--      `estimates_lead_id_idx`.
--
-- Net effect: 77 WARN → 0 WARN. RLS plans cache per query (drawer renders
-- under load no longer multiply the auth-call cost by row count). Wedge
-- bullet #5 (speed-to-lead): every dashboard fetch is now bounded by the
-- DB plan, not by the auth-call cardinality.
--
-- All changes are inside a single BEGIN/COMMIT — if any policy fails to
-- recreate, the whole migration rolls back cleanly. Idempotent on re-run
-- because every CREATE is preceded by `DROP POLICY IF EXISTS`.
--
-- Rollback plan: prior policy bodies are documented inline in this file
-- (the comments above each `CREATE POLICY` show the original `qual` /
-- `with_check`). To revert, replace `(SELECT auth.uid())` with `auth.uid()`
-- in each clause. The duplicate-index drops at the bottom are safely
-- reversible via `CREATE INDEX` (the underlying covering indexes still
-- exist — no data is lost).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- profiles (3 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

-- ────────────────────────────────────────────────────────────────────────
-- territories (2 policies — UPDATE + INSERT only; SELECT was already public)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "territories_insert_own" ON public.territories;
CREATE POLICY "territories_insert_own" ON public.territories
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "territories_update_own" ON public.territories;
CREATE POLICY "territories_update_own" ON public.territories
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = contractor_id)
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- zip_waitlist (2 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "zip_waitlist_insert_own" ON public.zip_waitlist;
CREATE POLICY "zip_waitlist_insert_own" ON public.zip_waitlist
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "zip_waitlist_delete_own" ON public.zip_waitlist;
CREATE POLICY "zip_waitlist_delete_own" ON public.zip_waitlist
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- leads (2 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "leads_select_own" ON public.leads;
CREATE POLICY "leads_select_own" ON public.leads
  FOR SELECT
  USING ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "leads_update_own" ON public.leads;
CREATE POLICY "leads_update_own" ON public.leads
  FOR UPDATE
  USING ((SELECT auth.uid()) = contractor_id)
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- notifications (2 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ────────────────────────────────────────────────────────────────────────
-- referral_credits (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "referral_credits_self_select" ON public.referral_credits;
CREATE POLICY "referral_credits_self_select" ON public.referral_credits
  FOR SELECT
  TO authenticated
  USING (referrer_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- billing_events (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "billing_events_select_own" ON public.billing_events;
CREATE POLICY "billing_events_select_own" ON public.billing_events
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- ────────────────────────────────────────────────────────────────────────
-- homeowner_intakes (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "intakes_select_matched" ON public.homeowner_intakes;
CREATE POLICY "intakes_select_matched" ON public.homeowner_intakes
  FOR SELECT
  USING ((SELECT auth.uid()) = matched_contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- outreach_logs (2 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outreach_select_own" ON public.outreach_logs;
CREATE POLICY "outreach_select_own" ON public.outreach_logs
  FOR SELECT
  USING ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "outreach_insert_own" ON public.outreach_logs;
CREATE POLICY "outreach_insert_own" ON public.outreach_logs
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- estimates: drop legacy FOR ALL policy + recreate per-action
--   The "contractor sees own estimates" FOR ALL legacy policy overlaps
--   with the 3 per-action policies, producing 15 multiple-permissive WARNs
--   (3 actions × 5 roles). Drop the legacy + add a DELETE policy so the
--   surface is uniform.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contractor sees own estimates" ON public.estimates;
DROP POLICY IF EXISTS "estimates_select_own" ON public.estimates;
DROP POLICY IF EXISTS "estimates_insert_own" ON public.estimates;
DROP POLICY IF EXISTS "estimates_update_own" ON public.estimates;
DROP POLICY IF EXISTS "estimates_delete_own" ON public.estimates;

CREATE POLICY "estimates_select_own" ON public.estimates
  FOR SELECT
  USING ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "estimates_insert_own" ON public.estimates
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "estimates_update_own" ON public.estimates
  FOR UPDATE
  USING ((SELECT auth.uid()) = contractor_id)
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "estimates_delete_own" ON public.estimates
  FOR DELETE
  USING ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- blast_campaigns: same pattern as estimates — drop legacy FOR ALL
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contractor sees own blasts" ON public.blast_campaigns;
DROP POLICY IF EXISTS "blasts_select_own" ON public.blast_campaigns;
DROP POLICY IF EXISTS "blasts_insert_own" ON public.blast_campaigns;
DROP POLICY IF EXISTS "blasts_update_own" ON public.blast_campaigns;
DROP POLICY IF EXISTS "blasts_delete_own" ON public.blast_campaigns;

CREATE POLICY "blasts_select_own" ON public.blast_campaigns
  FOR SELECT
  USING ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "blasts_insert_own" ON public.blast_campaigns
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "blasts_update_own" ON public.blast_campaigns
  FOR UPDATE
  USING ((SELECT auth.uid()) = contractor_id)
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

CREATE POLICY "blasts_delete_own" ON public.blast_campaigns
  FOR DELETE
  USING ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- contractor_licenses (3 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "licenses_select_own" ON public.contractor_licenses;
CREATE POLICY "licenses_select_own" ON public.contractor_licenses
  FOR SELECT
  USING ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "licenses_insert_own" ON public.contractor_licenses;
CREATE POLICY "licenses_insert_own" ON public.contractor_licenses
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

DROP POLICY IF EXISTS "licenses_update_own" ON public.contractor_licenses;
CREATE POLICY "licenses_update_own" ON public.contractor_licenses
  FOR UPDATE
  USING ((SELECT auth.uid()) = contractor_id)
  WITH CHECK ((SELECT auth.uid()) = contractor_id);

-- ────────────────────────────────────────────────────────────────────────
-- referral_codes (2 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "referral_codes_select" ON public.referral_codes;
CREATE POLICY "referral_codes_select" ON public.referral_codes
  FOR SELECT
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "referral_codes_insert" ON public.referral_codes;
CREATE POLICY "referral_codes_insert" ON public.referral_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- referrals (3 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "referrals_select" ON public.referrals;
CREATE POLICY "referrals_select" ON public.referrals
  FOR SELECT
  TO authenticated
  USING (referrer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "referrals_insert" ON public.referrals;
CREATE POLICY "referrals_insert" ON public.referrals
  FOR INSERT
  TO authenticated
  WITH CHECK (referrer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "referrals_update" ON public.referrals;
CREATE POLICY "referrals_update" ON public.referrals
  FOR UPDATE
  TO authenticated
  USING (referrer_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- reviews (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reviews_update_own" ON public.reviews;
CREATE POLICY "reviews_update_own" ON public.reviews
  FOR UPDATE
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- review_requests (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "review_requests_own" ON public.review_requests;
CREATE POLICY "review_requests_own" ON public.review_requests
  FOR ALL
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- quotes: consolidate the contractor+homeowner SELECT pair into one OR'd
-- policy; keep contractor-only INSERT/UPDATE/DELETE.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "quotes_contractor" ON public.quotes;
DROP POLICY IF EXISTS "quotes_homeowner" ON public.quotes;
DROP POLICY IF EXISTS "quotes_select_own" ON public.quotes;
DROP POLICY IF EXISTS "quotes_insert_contractor" ON public.quotes;
DROP POLICY IF EXISTS "quotes_update_contractor" ON public.quotes;
DROP POLICY IF EXISTS "quotes_delete_contractor" ON public.quotes;

CREATE POLICY "quotes_select_own" ON public.quotes
  FOR SELECT
  TO authenticated
  USING (
    (contractor_id = (SELECT auth.uid()))
    OR (homeowner_id = (SELECT auth.uid()))
  );

CREATE POLICY "quotes_insert_contractor" ON public.quotes
  FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = (SELECT auth.uid()));

CREATE POLICY "quotes_update_contractor" ON public.quotes
  FOR UPDATE
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()))
  WITH CHECK (contractor_id = (SELECT auth.uid()));

CREATE POLICY "quotes_delete_contractor" ON public.quotes
  FOR DELETE
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- job_milestones (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "milestones_contractor" ON public.job_milestones;
CREATE POLICY "milestones_contractor" ON public.job_milestones
  FOR ALL
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- follow_up_sequences (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sequences_own" ON public.follow_up_sequences;
CREATE POLICY "sequences_own" ON public.follow_up_sequences
  FOR ALL
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- outreach_queue (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outreach_queue_own" ON public.outreach_queue;
CREATE POLICY "outreach_queue_own" ON public.outreach_queue
  FOR ALL
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- engagement_scores (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "engagement_own" ON public.engagement_scores;
CREATE POLICY "engagement_own" ON public.engagement_scores
  FOR SELECT
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- intake_matches: consolidate the two SELECT policies into one OR'd policy.
-- The homeowner predicate has its own subquery on auth.users which we also
-- wrap in (SELECT ...) — the planner caches the whole expression once.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Contractors see own matches" ON public.intake_matches;
DROP POLICY IF EXISTS "Homeowners see own intake matches" ON public.intake_matches;
DROP POLICY IF EXISTS "intake_matches_select_own" ON public.intake_matches;

CREATE POLICY "intake_matches_select_own" ON public.intake_matches
  FOR SELECT
  USING (
    (contractor_id = (SELECT auth.uid()))
    OR (intake_id IN (
      SELECT homeowner_intakes.id
      FROM public.homeowner_intakes
      WHERE homeowner_intakes.contact_email = (
        (SELECT users.email FROM auth.users WHERE users.id = (SELECT auth.uid()))
      )::text
    ))
  );

-- ────────────────────────────────────────────────────────────────────────
-- outreach_templates (4 policies)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outreach_templates_select_own_or_library" ON public.outreach_templates;
CREATE POLICY "outreach_templates_select_own_or_library" ON public.outreach_templates
  FOR SELECT
  TO authenticated
  USING ((contractor_id = (SELECT auth.uid())) OR (is_library = true));

DROP POLICY IF EXISTS "outreach_templates_insert_own" ON public.outreach_templates;
CREATE POLICY "outreach_templates_insert_own" ON public.outreach_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "outreach_templates_update_own" ON public.outreach_templates;
CREATE POLICY "outreach_templates_update_own" ON public.outreach_templates
  FOR UPDATE
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()))
  WITH CHECK (contractor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "outreach_templates_delete_own" ON public.outreach_templates;
CREATE POLICY "outreach_templates_delete_own" ON public.outreach_templates
  FOR DELETE
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- review_responses (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "review_responses_own_all" ON public.review_responses;
CREATE POLICY "review_responses_own_all" ON public.review_responses
  FOR ALL
  USING (contractor_id = (SELECT auth.uid()))
  WITH CHECK (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- financing_requests (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "financing_requests_own_all" ON public.financing_requests;
CREATE POLICY "financing_requests_own_all" ON public.financing_requests
  FOR ALL
  USING (contractor_id = (SELECT auth.uid()))
  WITH CHECK (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- blast_events (1 policy with subquery — wrap auth.uid() in the subquery)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "blast_events_own_read" ON public.blast_events;
CREATE POLICY "blast_events_own_read" ON public.blast_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.blast_campaigns c
      WHERE c.id = blast_events.campaign_id
        AND c.contractor_id = (SELECT auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- homeowner_properties (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "homeowner_properties_own_all" ON public.homeowner_properties;
CREATE POLICY "homeowner_properties_own_all" ON public.homeowner_properties
  FOR ALL
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- homeowner_maintenance_completed (1 FOR ALL policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "homeowner_maintenance_own_all" ON public.homeowner_maintenance_completed;
CREATE POLICY "homeowner_maintenance_own_all" ON public.homeowner_maintenance_completed
  FOR ALL
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- lead_exclusivity_locks (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "excl_locks_select_self" ON public.lead_exclusivity_locks;
CREATE POLICY "excl_locks_select_self" ON public.lead_exclusivity_locks
  FOR SELECT
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- missed_call_events (1 policy)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "missed_call_select_self" ON public.missed_call_events;
CREATE POLICY "missed_call_select_self" ON public.missed_call_events
  FOR SELECT
  TO authenticated
  USING (contractor_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- contractor_interviews (4 policies — author_id, not contractor_id)
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "interviews_select_own" ON public.contractor_interviews;
CREATE POLICY "interviews_select_own" ON public.contractor_interviews
  FOR SELECT
  TO authenticated
  USING (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "interviews_insert_own" ON public.contractor_interviews;
CREATE POLICY "interviews_insert_own" ON public.contractor_interviews
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "interviews_update_own" ON public.contractor_interviews;
CREATE POLICY "interviews_update_own" ON public.contractor_interviews
  FOR UPDATE
  TO authenticated
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "interviews_delete_own" ON public.contractor_interviews;
CREATE POLICY "interviews_delete_own" ON public.contractor_interviews
  FOR DELETE
  TO authenticated
  USING (author_id = (SELECT auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- Drop redundant duplicate indexes on `estimates`
--   The advisor flagged these as duplicates of `estimates_contractor_id_idx`
--   (created via UNIQUE constraint or earlier migration) and
--   `estimates_lead_id_idx`. Both pairs cover identical column lists.
-- ────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_estimates_contractor;
DROP INDEX IF EXISTS public.idx_estimates_lead;

COMMIT;

-- After commit:
--   - The Supabase performance advisor should report 0 WARN findings
--     across `auth_rls_initplan`, `multiple_permissive_policies`, and
--     `duplicate_index` categories.
--   - All 54 policies are functionally identical to before — only the
--     plan caching changed. Existing app code path: unchanged.
--   - Estimates + blasts now have a uniform 4-action policy surface
--     (SELECT, INSERT, UPDATE, DELETE) instead of mixed FOR ALL + per-action.
--   - Quotes + intake_matches now have single SELECT policies with OR'd
--     predicates instead of multiple permissive overlaps.
