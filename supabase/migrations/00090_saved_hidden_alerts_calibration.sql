-- ─────────────────────────────────────────────────────────────────────
-- 00090 · Modules 11 + 13 + 14 schema.
--
--   Module 11: saved_leads + hidden_leads — drawer save/hide actions.
--   Module 13: score_trade_weights + score_stage_modifiers — calibration
--              tables the existing scorer reads.
--   Module 14: alert_rules — per-contractor notification rules.
--
-- All four tables follow the established Henri pattern:
--   - contractor_id uuid REFERENCES profiles(id)
--   - created_at + updated_at + moddatetime trigger
--   - RLS enabled; self-policy on (contractor_id = auth.uid()).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── Module 11.A: saved_leads ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_leads_unique UNIQUE (contractor_id, lead_id)
);

CREATE INDEX IF NOT EXISTS saved_leads_contractor_idx
  ON public.saved_leads (contractor_id, created_at DESC);

ALTER TABLE public.saved_leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY saved_leads_self_select ON public.saved_leads
    FOR SELECT USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saved_leads_self_insert ON public.saved_leads
    FOR INSERT WITH CHECK (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saved_leads_self_update ON public.saved_leads
    FOR UPDATE USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saved_leads_self_delete ON public.saved_leads
    FOR DELETE USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER saved_leads_moddatetime
    BEFORE UPDATE ON public.saved_leads
    FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Module 11.B: hidden_leads ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hidden_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hidden_leads_unique UNIQUE (contractor_id, lead_id)
);

CREATE INDEX IF NOT EXISTS hidden_leads_contractor_idx
  ON public.hidden_leads (contractor_id, created_at DESC);

ALTER TABLE public.hidden_leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY hidden_leads_self_select ON public.hidden_leads
    FOR SELECT USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY hidden_leads_self_insert ON public.hidden_leads
    FOR INSERT WITH CHECK (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY hidden_leads_self_delete ON public.hidden_leads
    FOR DELETE USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Module 13: score calibration tables ──────────────────────────
CREATE TABLE IF NOT EXISTS public.score_trade_weights (
  trade text PRIMARY KEY,
  freshness_weight numeric NOT NULL DEFAULT 1.0,
  value_weight     numeric NOT NULL DEFAULT 1.0,
  contact_weight   numeric NOT NULL DEFAULT 1.0,
  demand_weight    numeric NOT NULL DEFAULT 1.0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.score_stage_modifiers (
  stage text PRIMARY KEY,
  cap   int NOT NULL DEFAULT 100,
  base_modifier numeric NOT NULL DEFAULT 1.0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed sensible defaults — founder edits later.
INSERT INTO public.score_trade_weights (trade, freshness_weight, value_weight, contact_weight, demand_weight, notes) VALUES
  ('roofing',  1.20, 1.00, 1.00, 1.00, 'storms drive urgency — freshness weighted up'),
  ('hvac',     1.15, 1.00, 1.00, 1.10, 'seasonal demand'),
  ('solar',    1.00, 1.20, 1.00, 1.00, 'higher commitment per project'),
  ('plumbing', 1.10, 0.90, 1.10, 1.00, 'urgency varies; emergency plumbing weighted up'),
  ('electrical', 1.00, 1.00, 1.10, 1.00, 'panel-upgrade demand cycle'),
  ('adu',      0.95, 1.30, 1.00, 1.10, 'high-value projects with long lead time'),
  ('general',  1.00, 1.00, 1.00, 1.00, 'default — no calibration')
ON CONFLICT (trade) DO NOTHING;

INSERT INTO public.score_stage_modifiers (stage, cap, base_modifier, notes) VALUES
  ('homeowner_submitted',           100, 1.00, 'hot — homeowner is actively hiring'),
  ('permit_filed_no_contractor',    100, 1.00, 'hot — homeowner still hiring'),
  ('permit_filed_with_contractor',   80, 0.85, 'cooler — GC already on the job; subs only'),
  ('project_moving',                 75, 0.80, 'cooler — project past hire stage'),
  ('active_intent',                  90, 0.95, 'warming up'),
  ('pre_intent',                     60, 0.70, 'speculative — score capped to keep noise out'),
  ('stalled',                        70, 0.85, 'expediter opportunity'),
  ('expired',                        65, 0.80, 'expediter opportunity'),
  ('completed',                      40, 0.50, 'cool — past completion'),
  ('maintenance_upsell',             65, 0.70, 'maintenance window only'),
  ('archived',                        0, 0.00, 'archived rows shouldn''t score')
ON CONFLICT (stage) DO NOTHING;

-- ─── Module 14: alert_rules ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  /* Allowed kinds (validated in code, not DB):
   *   'high_score'              — fire when a new lead crosses a score threshold
   *   'permit_no_contractor'    — fire when stage = permit_filed_no_contractor in claimed ZIPs
   *   'homeowner_match'         — fire when a homeowner intake matches the contractor's trade
   *   'stage_change'            — fire when an existing lead transitions to a target stage */
  kind text NOT NULL,
  /* Criteria as JSONB — kind-specific schema:
   *   high_score        → { "min_score": 75, "trades": ["roofing"] }
   *   permit_no_contractor → { "zip": null }   // null = all my territories
   *   homeowner_match   → { "trades": ["adu","remodel"] }
   *   stage_change      → { "from": "active_intent", "to": "permit_filed_no_contractor" }
   */
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','none')),
  last_fired_at timestamptz,
  fire_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_contractor_idx
  ON public.alert_rules (contractor_id, enabled);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY alert_rules_self_select ON public.alert_rules
    FOR SELECT USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY alert_rules_self_insert ON public.alert_rules
    FOR INSERT WITH CHECK (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY alert_rules_self_update ON public.alert_rules
    FOR UPDATE USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY alert_rules_self_delete ON public.alert_rules
    FOR DELETE USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER alert_rules_moddatetime
    BEFORE UPDATE ON public.alert_rules
    FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
