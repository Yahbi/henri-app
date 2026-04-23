-- ═══════════════════════════════════════════════════════════════════════════
-- Manual DDL handoff — paste this entire file into the Supabase SQL Editor
-- for project ivfxylgoxgrxttknewsf and click RUN.
--
-- Covers gap-audit items G12 (unblock /dashboard/settings) and G13
-- (lift statement-timeout ceiling for authenticated reads).
--
-- Everything here is idempotent — safe to re-run. It does NOT touch data.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Missing ALTER COLUMN adds from migration 00026 (profile billing + licensing)
--    Currently, useUser.ts selects columns (trial_ends_at, licensed_until,
--    license_state, ...) that don't exist on the live `profiles` table.
--    Without these, the client query errors and freezes /dashboard/settings
--    on a skeleton — the useUser G11 try/finally patch lets the page render,
--    but these columns are still needed by TopBar (trial pill) and
--    /api/licenses/verify cron and /api/billing/change-plan.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS licensed_until date,
  ADD COLUMN IF NOT EXISTS license_state text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS last_license_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_plan text,
  ADD COLUMN IF NOT EXISTS pending_plan_effective_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_compliance_check_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_licensed_until
  ON public.profiles (licensed_until)
  WHERE licensed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_pending_plan_effective
  ON public.profiles (pending_plan_effective_at)
  WHERE pending_plan IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Migration 00027 (review responses + financing requests) — idempotent
--    re-run. Skipped silently if already applied.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL,
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review
  ON public.review_responses (review_id);

CREATE TABLE IF NOT EXISTS public.financing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid,
  amount numeric(12,2) NOT NULL,
  term_months integer NOT NULL,
  apr numeric(5,2) NOT NULL,
  partner text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financing_requests_contractor
  ON public.financing_requests (contractor_id, created_at DESC);

ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_requests ENABLE ROW LEVEL SECURITY;

-- Use DO blocks so policy CREATE is also idempotent (there's no
-- CREATE POLICY IF NOT EXISTS syntax in Postgres).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='review_responses' AND policyname='review_responses_own_all'
  ) THEN
    CREATE POLICY "review_responses_own_all"
      ON public.review_responses
      FOR ALL
      USING (contractor_id = auth.uid())
      WITH CHECK (contractor_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financing_requests' AND policyname='financing_requests_own_all'
  ) THEN
    CREATE POLICY "financing_requests_own_all"
      ON public.financing_requests
      FOR ALL
      USING (contractor_id = auth.uid())
      WITH CHECK (contractor_id = auth.uid());
  END IF;
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Migration 00028 (blast events + estimates delivery) — idempotent.
--    blast_events FKs blast_campaigns(id); blast_campaigns must exist first
--    (created in 00016 or earlier). Skipped silently if already applied.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blast_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.blast_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  delivered boolean NOT NULL DEFAULT false,
  error text,
  provider_message_id text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blast_events_campaign
  ON public.blast_events (campaign_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_blast_events_lead
  ON public.blast_events (lead_id);

ALTER TABLE public.blast_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blast_events' AND policyname='blast_events_own_read'
  ) THEN
    CREATE POLICY "blast_events_own_read"
      ON public.blast_events
      FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.blast_campaigns c
        WHERE c.id = blast_events.campaign_id
          AND c.contractor_id = auth.uid()
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blast_events' AND policyname='blast_events_service_all'
  ) THEN
    CREATE POLICY "blast_events_service_all"
      ON public.blast_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END$$;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_to_email text,
  ADD COLUMN IF NOT EXISTS delivered_pdf_url text;

CREATE INDEX IF NOT EXISTS idx_estimates_delivered_at
  ON public.estimates (delivered_at)
  WHERE delivered_at IS NOT NULL;

ALTER TABLE public.blast_campaigns
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. G13 — Statement-timeout uplift for authenticated reads.
--    Default Supabase timeout for the `authenticated` role is 8 s, which
--    isn't enough for COUNT(*) on the 133k-row leads table nor for the
--    paginated leads+permits join in /api/leads/map (observed failures
--    at offset 8000+). Lift to 30 s — enough headroom for the dashboard
--    without risking a runaway query on other endpoints.
--
--    Matches the pattern used by shipped counts (which already use
--    `count: "exact"` + fallback to `planned` on error — see
--    src/app/api/leads/count/route.ts).
-- ───────────────────────────────────────────────────────────────────────────

ALTER ROLE authenticated SET statement_timeout = '30s';

-- Make the new setting visible to open connections immediately.
-- (New pooled connections get it automatically via ALTER ROLE.)
SELECT pg_reload_conf();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Supplementary leads-table index for the dashboard's most frequent query
--    pattern — WHERE contractor_id=? ORDER BY score DESC LIMIT N. The
--    existing idx_leads_contractor_score covers this, but we want the
--    partial version that skips nullable scores for the map's default view.
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_contractor_score_notnull
  ON public.leads (contractor_id, score DESC)
  WHERE score IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify: after RUN completes, paste this into a fresh SQL editor tab to
-- sanity-check what got applied.
--
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='profiles'
--       AND column_name IN ('trial_ends_at','licensed_until','license_state','license_number','last_license_verified_at','pending_plan','pending_plan_effective_at','last_compliance_check_at')
--     ORDER BY column_name;
--   -- should return 8 rows.
--
--   SELECT indexname FROM pg_indexes WHERE tablename='leads'
--     AND indexname = 'idx_leads_contractor_score_notnull';
--   -- should return 1 row.
--
--   SHOW statement_timeout;  -- inside a connection as `authenticated` role
-- ═══════════════════════════════════════════════════════════════════════════
