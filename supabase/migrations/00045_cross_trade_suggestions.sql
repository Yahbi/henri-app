-- 00045_cross_trade_suggestions.sql
-- Adds the `cross_trade_suggestions` jsonb column on `leads` for the
-- predictive rules engine (Phase 1.2 of the 2026-04-26 product roadmap).
--
-- Background: Henri's wedge contract bullet #1 makes exclusivity locks
-- per-(lead_id, trade), which means a single property can be "owned" by
-- contractor A for trade=roofing AND contractor B for trade=landscaping
-- simultaneously. Migration 00025 already aggregates per-property permit
-- history into `address_permit_history`. The predictive engine in
-- `src/lib/predictive/rules.ts` consumes that history + the current lead
-- to derive cross-trade opportunities (pool→landscaping, pre-1990
-- + no-electrical→electrical-upgrade, roof age>20yr→re-roof, etc.).
--
-- Schema is a single jsonb column. Each entry has:
--   {
--     "trade": "landscaping",
--     "rule": "pool-to-landscaper",
--     "confidence": 0.75,
--     "reason": "Pool homeowners spend $8-25k on landscape after install",
--     "generated_at": "2026-04-26T19:00:00Z"
--   }
--
-- The cron job `/api/cron/score` writes this column when env
-- `WRITE_CROSS_TRADE_SUGGESTIONS=1` is set. Reading is graceful-degrade:
-- the LeadDetailDrawer's CrossTradeOpportunities section renders only
-- when the array is non-empty.
--
-- Additive-only. NULL by default. Zero impact on existing rows.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cross_trade_suggestions jsonb;

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate          (preferred)
--   OR paste into the Supabase SQL editor.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'leads' AND column_name = 'cross_trade_suggestions';
-- Should return 1 row.
--
-- After applying, set WRITE_CROSS_TRADE_SUGGESTIONS=1 in Vercel env to
-- enable the cron writer. Without the flag, the column stays NULL and
-- the drawer surface is silent — same graceful-degrade pattern as
-- WRITE_PROVENANCE / WRITE_EXTENDED.
