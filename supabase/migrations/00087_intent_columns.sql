-- ─────────────────────────────────────────────────────────────────────
-- 00087 · Intent classification columns on `leads` + `homeowner_intakes`.
--
-- Module 1 of the 18-module enhancement plan (2026-05-09 plan §9.1).
-- Adds three columns:
--
--   opportunity_stage  text   -- one of 11 allowed values, validated in
--                                 src/lib/intent/classify.ts (NOT a
--                                 Postgres enum so we can iterate values
--                                 without a migration).
--   reason_codes       text[] -- per-row reason-code list (~60 codes
--                                 defined in src/lib/intent/reason-codes.ts).
--                                 Powers drawer chips + filter facets.
--   trade_tags         text[] -- richer trade taxonomy (founder named 18+
--                                 trades; existing trade_type enum is 10).
--                                 Additive — existing `trade` column stays.
--
-- Allowed `opportunity_stage` values (validated in code, not in DB):
--   pre_intent · active_intent · homeowner_submitted ·
--   permit_filed_no_contractor · permit_filed_with_contractor ·
--   project_moving · stalled · expired · completed · maintenance_upsell ·
--   archived
--
-- All columns nullable / default empty array. Backfill happens via
-- scripts/_backfill-intent.mjs after the classifier ships.
--
-- Idempotent + additive. No breaking change to existing readers.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS opportunity_stage text,
  ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS trade_tags  text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.homeowner_intakes
  ADD COLUMN IF NOT EXISTS opportunity_stage text,
  ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS trade_tags  text[] NOT NULL DEFAULT '{}'::text[];

-- Cheap btree for stage filter dropdown queries. Partial index — most
-- pre-backfill rows are NULL and we don't need to index those.
CREATE INDEX IF NOT EXISTS leads_opportunity_stage_idx
  ON public.leads (opportunity_stage)
  WHERE opportunity_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS homeowner_intakes_opportunity_stage_idx
  ON public.homeowner_intakes (opportunity_stage)
  WHERE opportunity_stage IS NOT NULL;

-- GIN indexes for `reason_codes && ARRAY[…]` filter queries (e.g.
-- "show me leads with reason_codes containing 'no_contractor_listed'").
CREATE INDEX IF NOT EXISTS leads_reason_codes_gin
  ON public.leads USING gin (reason_codes);

CREATE INDEX IF NOT EXISTS leads_trade_tags_gin
  ON public.leads USING gin (trade_tags);

COMMENT ON COLUMN public.leads.opportunity_stage IS
  '00087 - Intent classification. Allowed values defined in src/lib/intent/classify.ts.';
COMMENT ON COLUMN public.leads.reason_codes IS
  '00087 - Intent reason codes (~60 codes in src/lib/intent/reason-codes.ts). Drives drawer tooltips + filter facets.';
COMMENT ON COLUMN public.leads.trade_tags IS
  '00087 - Trade tags (richer than existing trade column). 22 taxonomy values per founder prompt.';

COMMIT;
