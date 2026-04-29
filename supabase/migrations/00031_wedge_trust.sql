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
