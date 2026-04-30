-- 00065_agent_actions.sql
-- Tier A+ Sprint 3 — agent observability + budget infrastructure.
--
-- Two tables for the read-only AI-analyst agents (A1 lead summary,
-- A2 weekly briefing):
--
-- 1. agent_actions: immutable audit log. Every LLM call generates one
--    row. Captures actor, action, target, prompt+output hashes, token
--    counts, cost, timestamp. Compliance + incident-response trail.
--
-- 2. agent_budgets: per-contractor monthly token cap. Soft alert at
--    80%, hard halt at 100%. Defends against runaway LLM spend.
--
-- Tier A+ compliance: NO PII stored. prompt_hash + output_hash are
-- SHA-256 of the prompt/output text — opaque, not reversible to PII.
-- The text itself is NOT stored. Hashes let us detect duplicate
-- generations + verify outputs after the fact without retaining the
-- conversation.
--
-- RLS: contractor sees their own audit log; service-role full access.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- agent_actions — immutable audit log
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The contractor (or system, for cron-driven actions like A2)
  contractor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Action key — short string identifying which agent fired
  -- ('a1.lead_summary', 'a2.weekly_briefing', etc.)
  action text NOT NULL CHECK (char_length(action) > 0),

  -- Target row (lead_id, etc. depending on action)
  target_table text,
  target_id uuid,

  -- LLM provenance
  model text NOT NULL,
  model_version text,

  -- Hashes (opaque) — let us verify outputs without storing prompt/text
  prompt_hash text NOT NULL,
  output_hash text,

  -- Cost accounting
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),

  -- Outcome
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'over_budget', 'kill_switch')),
  error_message text,

  -- Disclaimer rendered: was the FTC § 5 disclaimer shown to the user?
  -- Boolean defaults to true; explicit false only if surface bypassed disclaimer.
  disclaimer_rendered boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Index for "show me this contractor's recent agent actions"
CREATE INDEX IF NOT EXISTS agent_actions_contractor_id_created_at_idx
  ON public.agent_actions (contractor_id, created_at DESC);

-- Index for cost dashboards
CREATE INDEX IF NOT EXISTS agent_actions_action_created_at_idx
  ON public.agent_actions (action, created_at DESC);

-- Index for monthly cost rollups by contractor
CREATE INDEX IF NOT EXISTS agent_actions_contractor_month_idx
  ON public.agent_actions (contractor_id, date_trunc('month', created_at));

-- RLS — contractor reads their own
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_actions_select_own" ON public.agent_actions;
CREATE POLICY "agent_actions_select_own" ON public.agent_actions
  FOR SELECT
  USING (contractor_id = (SELECT auth.uid()));

-- No INSERT/UPDATE/DELETE policy → service-role-only writes (the
-- orchestrator uses createAdminClient).

COMMENT ON TABLE public.agent_actions IS
  'Immutable audit log for AI-analyst agents (Tier A+ Sprint 3). '
  'Stores hashes, NOT prompt/output text. Contractor reads own; '
  'service-role full access.';

-- ────────────────────────────────────────────────────────────────────────
-- agent_budgets — per-contractor monthly token cap
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_budgets (
  contractor_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Cap for the current period (Token-counted; not USD).
  -- Default: 30,000 tokens/month ≈ ~$3 with Sonnet, ~$0.15 with Haiku.
  -- 10× headroom from the cost model's 100-leads/day forecast.
  monthly_token_cap integer NOT NULL DEFAULT 30000 CHECK (monthly_token_cap >= 0),

  -- Tokens used in the current period
  monthly_tokens_used integer NOT NULL DEFAULT 0 CHECK (monthly_tokens_used >= 0),

  -- Period anchor (start of the month tracked)
  period_start date NOT NULL DEFAULT date_trunc('month', NOW())::date,

  -- When was the contractor alerted that they hit 80% of cap?
  alerted_at timestamptz,

  -- When was the budget halted (hit 100%)?
  halted_at timestamptz,

  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_budgets_period_start_idx
  ON public.agent_budgets (period_start);

ALTER TABLE public.agent_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_budgets_select_own" ON public.agent_budgets;
CREATE POLICY "agent_budgets_select_own" ON public.agent_budgets
  FOR SELECT
  USING (contractor_id = (SELECT auth.uid()));

COMMENT ON TABLE public.agent_budgets IS
  'Per-contractor monthly LLM token cap. Service-role-only writes. '
  'Defaults to 30k tokens/month (~$3 Sonnet, ~$0.15 Haiku).';

COMMIT;
