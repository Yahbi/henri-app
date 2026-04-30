-- 00066_weekly_briefings.sql
-- Tier A+ Sprint 3 — A2 weekly briefing storage.
--
-- The orchestrator's `agent_actions` table stores HASHES only (privacy-by-
-- design). The weekly briefing is contractor-facing rendered text, so it
-- needs its own cache table.
--
-- One row per contractor per generation. The /api/cron/weekly-briefing
-- cron INSERTs a fresh row weekly; the dashboard hook reads the latest
-- row. Old rows are retained for audit (no automatic GC — small volume).
--
-- Tier A+ compliance:
--   • Read-only — no contractor writes (service-role only)
--   • Contractor-scoped via RLS
--   • No PII (briefing text describes territory aggregates, never homeowners)
--   • Disclaimer rendered in the UI, recorded with the row

BEGIN;

CREATE TABLE IF NOT EXISTS public.weekly_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The generated narrative (2-4 sentences, max 4kb per orchestrator validator).
  output text NOT NULL CHECK (char_length(output) > 0 AND char_length(output) <= 4000),

  -- The aggregate facts the agent saw (kept for transparency + drilldown).
  aggregates jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Cost accounting
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),

  -- The model that produced this briefing (for audit + back-fill of
  -- outputs after a model change).
  model text NOT NULL,

  -- The week this briefing covers (ISO week start, Monday).
  -- Cron always sets this to the Monday of the current ISO week.
  period_start date NOT NULL,

  -- When the agent finished writing this briefing.
  generated_at timestamptz NOT NULL DEFAULT NOW(),

  -- Was the FTC § 5 disclaimer rendered to the user? (UI is required to
  -- render it; this records the assertion at generation time.)
  disclaimer_rendered boolean NOT NULL DEFAULT true
);

-- One briefing per contractor per ISO week (idempotent cron retries).
CREATE UNIQUE INDEX IF NOT EXISTS weekly_briefings_contractor_period_idx
  ON public.weekly_briefings (contractor_id, period_start);

-- Read path: "show me this contractor's most recent briefing"
CREATE INDEX IF NOT EXISTS weekly_briefings_contractor_generated_at_idx
  ON public.weekly_briefings (contractor_id, generated_at DESC);

ALTER TABLE public.weekly_briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_briefings_select_own" ON public.weekly_briefings;
CREATE POLICY "weekly_briefings_select_own" ON public.weekly_briefings
  FOR SELECT
  USING (contractor_id = (SELECT auth.uid()));

-- No INSERT/UPDATE/DELETE policy: service-role only via createAdminClient.

COMMENT ON TABLE public.weekly_briefings IS
  'Tier A+ Sprint 3 — A2 read-only weekly opportunity briefing per '
  'contractor. One row/week. Service-role writes; contractor reads own '
  'via RLS. No PII; describes territory aggregates only.';

COMMIT;
