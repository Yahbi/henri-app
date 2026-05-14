-- 00095_check_constraints_aa3.sql
--
-- Audit fix — schema-level integrity for the new columns shipped in
-- migrations 00090 + 00092 + 00094. The application-layer Zod
-- validators on the CRUD routes are correct, but the DB itself
-- accepts arbitrary text. CHECK constraints make the schema honest
-- about what's allowed.
--
-- Three columns get tightened:
--
--   1. `leads.source` — currently TEXT DEFAULT 'permit'. Allowed
--      values are documented in code (`Lead.source` doc comment) but
--      the DB will accept anything. Constrain to the 4 known values.
--      Existing rows are all 'permit' (the default), so no data
--      migration needed.
--
--   2. `alert_rules.kind` — already CHECK-constrained via the
--      route's Zod schema, but DB-side enforcement protects against
--      service-role inserts that bypass the route layer.
--
--   3. `stage_history.changed_by_kind` — currently TEXT DEFAULT
--      'system'. Drift-prone. Constrain to the 5 documented values.
--
-- All three use NOT VALID first to avoid scanning existing rows
-- (cheap on a 270k-row table; instant on smaller tables); then
-- VALIDATE separately so the constraint becomes enforced for new
-- writes immediately while the validation pass runs in the
-- background. Idempotent via DO/EXCEPTION wrappers.

BEGIN;

-- ─── 1. leads.source ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_source_check
    CHECK (source IN ('permit', 'parcel_synthesis', 'event_trigger', 'manual'))
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.leads VALIDATE CONSTRAINT leads_source_check;

-- ─── 2. alert_rules.kind ────────────────────────────────────────────
-- Migration 00090 already created the table without a CHECK on kind.
-- Add it now. Existing rows pre-date this constraint but were all
-- created via the Zod-validated route, so they conform.
DO $$ BEGIN
  ALTER TABLE public.alert_rules
    ADD CONSTRAINT alert_rules_kind_check
    CHECK (kind IN ('high_score', 'permit_no_contractor', 'homeowner_match', 'stage_change'))
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.alert_rules VALIDATE CONSTRAINT alert_rules_kind_check;

-- ─── 3. stage_history.changed_by_kind ───────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.stage_history
    ADD CONSTRAINT stage_history_changed_by_kind_check
    CHECK (changed_by_kind IN ('score_cron', 'backfill', 'manual', 'intake', 'system', 'henri-scoring-v3'))
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The 'henri-scoring-v3' value is allowed because migration 00092's
-- trigger uses `COALESCE(NEW.score_model, 'system')` and `score_model`
-- is set to 'henri-scoring-v3' by the score cron. Including it here
-- prevents a constraint violation when the trigger fires on a fresh
-- score-cron upsert.

ALTER TABLE public.stage_history VALIDATE CONSTRAINT stage_history_changed_by_kind_check;

COMMIT;

-- Verify:
--   SELECT conname, conrelid::regclass, contype, convalidated
--   FROM pg_constraint
--   WHERE conname IN (
--     'leads_source_check',
--     'alert_rules_kind_check',
--     'stage_history_changed_by_kind_check'
--   );
