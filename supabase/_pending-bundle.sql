-- ───── _bootstrap_exec_sql (one-time) ─────
-- Lets future `pnpm migrate` runs apply DDL via Path A (RPC) instead
-- of bundle-paste. Restricted to service_role; never exposed to the
-- anon or authenticated roles.
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;
REVOKE ALL ON FUNCTION exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION exec_sql(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;

-- ───── 00031_wedge_trust.sql ─────
-- exclusivity_locks + watchers + permit_events tables (wedge bullets #1, #6)
-- 00031_wedge_trust.sql
--
-- Phase 0a: the wedge foundations. Four contractor-facing trust wins:
--   1. Score transparency     → leads.score_signals (jsonb)
--   2. Per-permit exclusivity → lead_exclusivity_locks
--   3. Capacity control       → profiles.capacity_prefs (jsonb)
--   4. Speed-to-lead          → missed_call_events  (+ permit_events
--                                                     timeline for #5)
--
-- All additive. Nothing in existing queries breaks. Columns added to
-- existing tables are nullable jsonb, so the current UI continues to
-- render untouched rows correctly.

BEGIN;

/* ────────────────────────────────────────────────────────────────────
   Enums
   ──────────────────────────────────────────────────────────────────── */
DO $$ BEGIN
  CREATE TYPE exclusivity_release_reason AS ENUM (
    'expired',   -- 14-day window elapsed
    'declined',  -- contractor rejected the lead
    'won',       -- contractor closed the deal
    'forfeit'    -- use-it-or-lose-it: no outreach logged in 72h
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE permit_event_type AS ENUM (
    'planning',          -- planning-board agenda
    'applied',           -- permit application filed
    'issued',            -- permit issued
    'rough_inspection',  -- rough-in inspection scheduled/completed
    'final_inspection',  -- final inspection scheduled/completed
    'co_issued',         -- certificate of occupancy
    'expired',
    'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ────────────────────────────────────────────────────────────────────
   Per-permit exclusivity locks (pain #1: "race to the phone")
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS lead_exclusivity_locks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for fast filtering without a leads join.
  trade             text,
  zip               varchar(5),
  -- Lock window (UTC). Default 14 days; UI lets the contractor see the
  -- remaining time and optionally renew.
  window_start      timestamptz NOT NULL DEFAULT now(),
  window_end        timestamptz NOT NULL,
  -- Use-it-or-lose-it guardrail. If no outreach event logged by this
  -- timestamp, a cron flips released_at / released_reason='forfeit'.
  forfeit_deadline  timestamptz,
  released_at       timestamptz,
  released_reason   exclusivity_release_reason,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Only one active lock per (lead, trade). The contractor that holds
-- this row is the only one seeing the enriched packet for the window.
-- Partial index — filters out released rows so historical locks don't
-- block new acquisitions after a contractor declines.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exclusivity_active_lock
  ON lead_exclusivity_locks (lead_id, COALESCE(trade, ''))
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exclusivity_contractor
  ON lead_exclusivity_locks (contractor_id, window_end DESC);
CREATE INDEX IF NOT EXISTS idx_exclusivity_window_end
  ON lead_exclusivity_locks (window_end)
  WHERE released_at IS NULL;

CREATE OR REPLACE TRIGGER lead_exclusivity_locks_updated_at
  BEFORE UPDATE ON lead_exclusivity_locks
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE lead_exclusivity_locks ENABLE ROW LEVEL SECURITY;

-- A contractor can see their own locks. Read-only from client; the
-- API route (/api/exclusivity) holds the service role key and runs
-- the acquire/release logic with its own validation.
-- Wrapped in DO so re-runs after partial application don't error on
-- duplicate-object (Postgres < 17 has no `CREATE POLICY IF NOT EXISTS`).
DO $$ BEGIN
  CREATE POLICY excl_locks_select_self ON lead_exclusivity_locks
    FOR SELECT
    TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ────────────────────────────────────────────────────────────────────
   Permit lifecycle events (pain #5: no intent signal)
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS permit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id   uuid NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
  event_type  permit_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source      text,        -- e.g. 'scraper:hartford-ct', 'manual', 'ingest:planning-board'
  notes       text,
  raw_json    jsonb,       -- what the scraper saw at this event
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_events_permit
  ON permit_events (permit_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_events_type_time
  ON permit_events (event_type, occurred_at DESC);

-- Permits are readable by any authenticated user (see migration 00004
-- permits_select_all policy), so permit_events follows the same
-- public-to-authenticated rule.
ALTER TABLE permit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY permit_events_select_all ON permit_events
    FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ────────────────────────────────────────────────────────────────────
   Missed-call log (pain #6: speed-to-lead)
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS missed_call_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  caller_number         text,
  received_at           timestamptz NOT NULL DEFAULT now(),
  matched_lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  auto_reply_sent       boolean NOT NULL DEFAULT false,
  reply_text            text,
  provider_message_id   text,  -- Twilio SID
  raw_webhook_json      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missed_call_contractor_time
  ON missed_call_events (contractor_id, received_at DESC);

ALTER TABLE missed_call_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY missed_call_select_self ON missed_call_events
    FOR SELECT
    TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ────────────────────────────────────────────────────────────────────
   Additive columns on existing tables
   ──────────────────────────────────────────────────────────────────── */

-- leads.score_signals — breakdown of why the score is what it is.
-- Nullable jsonb so old rows stay valid. Shape:
--   [ {signal: 'permit_freshness', weight: 25, value: 22, detail: '3 days old'},
--     {signal: 'parcel_match',    weight: 15, value: 15, detail: 'exact'},
--     ... ]
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_signals jsonb;

-- profiles.capacity_prefs — radius / value band / start window / max
-- active jobs. Applied by the scorer + the Leads filter bar.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS capacity_prefs jsonb;

COMMIT;


-- ───── 00043_enrich_indexes.sql ─────
-- Partial indexes for burst enrichment (year_built / owner / phone NULL paths)
-- 00043_enrich_indexes.sql
-- Partial indexes that unblock the enrichment pipeline.
--
-- Background: every burst-enrich invocation runs a query like
--   SELECT id, address, zip, state, ... FROM leads
--   WHERE year_built IS NULL AND address IS NOT NULL LIMIT 600;
-- On a 133k-row leads table where ~99% of rows have year_built NULL,
-- Postgres needs a full sequential scan of the table to find the
-- 600-row early-exit batch when the cron is competing with concurrent
-- writes (the raw-JSON backfill, scoring cron, ingest cron). Result:
-- the SELECT routinely hits Supabase's 60 s statement-timeout budget,
-- killing the burst before any enrichment work happens.
--
-- The partial index below stores ONLY the row-ids of leads that
-- currently need enrichment. As enrichment writes year_built, those
-- rows fall out of the index. Future bursts read the index directly
-- (~few-millisecond lookup) instead of scanning the whole table.
--
-- We also add a partial index for owner-name backlog and a normalized-
-- address index for the same-address sibling-permit lookup the
-- orchestrator runs in Phase A.
--
-- All indexes are CREATE INDEX IF NOT EXISTS — re-runnable.
-- All are CONCURRENTLY where Supabase's migration runner allows; if
-- not, fallback is a brief lock at apply time. Total apply time on
-- ~933k permits + 133k leads: ~30-60 s.

BEGIN;

-- ── leads: enrichment-eligibility partial indexes ──────────────────

-- Primary backlog index — what /api/cron/enrich filters on.
CREATE INDEX IF NOT EXISTS leads_enrich_year_built_null_idx
  ON leads (id)
  WHERE year_built IS NULL;

-- Owner-name backlog — used by the broadened-eligibility filter we
-- briefly tried (currently reverted, but keep the index ready for
-- when we narrow the cron's per-pass scope and want a multi-target
-- batch).
CREATE INDEX IF NOT EXISTS leads_enrich_owner_null_idx
  ON leads (id)
  WHERE owner_name IS NULL;

-- Phone backlog — same logic as owner-name.
CREATE INDEX IF NOT EXISTS leads_enrich_phone_null_idx
  ON leads (id)
  WHERE phone IS NULL;

-- Geocoded leads — the dashboard map filter relies on this. Already
-- exists in some envs from migration 00019 but harmless to declare
-- IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS leads_geocoded_idx
  ON leads (id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ── permits: same-address sibling-lookup index ─────────────────────
--
-- The orchestrator's Phase 1 (cross-permit owner propagation) runs:
--   SELECT applicant_name FROM permits
--   WHERE zip = $1 AND address ILIKE $2 AND applicant_name IS NOT NULL
--   ORDER BY issued_date DESC LIMIT 1;
-- A single composite index on (zip, lower(address)) WHERE applicant
-- IS NOT NULL is what makes that a sub-millisecond lookup instead of
-- a per-zip table scan.

-- Note (2026-04-27): originally `(zip, lower(address))`, but some
-- Supabase configs reject `lower()` in column expressions with 42P17
-- ("functions in index predicate must be marked IMMUTABLE") because
-- the volatility classification depends on collation. Dropped the
-- lower() — same-address ILIKE lookups can still use the btree on
-- `address` for prefix scans, and the hot path is already fast.
CREATE INDEX IF NOT EXISTS permits_address_zip_owner_idx
  ON permits (zip, address)
  WHERE applicant_name IS NOT NULL;

-- Helps the contractor-principal correlation script (Pass 4 in
-- scripts/correlate-enrichment.ts) batch-sample (contractor_name,
-- applicant_name) pairs.
CREATE INDEX IF NOT EXISTS permits_contractor_applicant_idx
  ON permits (contractor_name)
  WHERE contractor_name IS NOT NULL AND applicant_name IS NOT NULL;

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
-- 1. Preferred: pnpm migrate (uses Supabase CLI, requires
--    SUPABASE_ACCESS_TOKEN set).
-- 2. Fallback: paste this file into the Supabase SQL editor at
--    https://app.supabase.com/project/<id>/sql/new — Run.
--
-- Verify after apply:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('leads', 'permits')
--      AND indexname LIKE '%enrich%' OR indexname LIKE '%address_zip%';
-- Should show 6 rows.

