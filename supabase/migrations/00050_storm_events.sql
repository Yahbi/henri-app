-- 00050_storm_events.sql
-- NOAA Storm Events Database ingest table.
--
-- Phase 2.3 of the post-audit roadmap. Free dataset from NCDC
-- (https://www.ncdc.noaa.gov/stormevents/) — geocoded, daily, no auth.
-- Massive wedge for roofing/storm-chaser contractors:
--   - Hail event 3 days ago in 33606 → flag every roof in that ZIP for
--     proactive outreach with insurance-claim language.
--   - Wind event with reported damage → trigger automated email with
--     pre-filled inspection request.
--
-- Schema is denormalized — one row per (event_id, location). NOAA
-- events have multiple "begin/end" location stamps; we flatten so a
-- spatial query "any storm event near (lat,lng) in last 7 days" is a
-- single index hit.
--
-- ## Index strategy
--
--   1. (state, zip, begin_date DESC) — covers "any event in this ZIP
--      in the last N days" (the dashboard storm-chip query)
--   2. (event_type, begin_date DESC) — covers "all hail events
--      nationwide in the last 24h" (cron alerts to roofing contractors)
--   3. PARTIAL on begin_date > now() - 30 days — keeps the hot index
--      tight; older events still queryable via seq scan
--
-- Daily cron `/api/cron/storm-events` does an INSERT … ON CONFLICT DO
-- NOTHING for the last 7 days; idempotent for re-runs after a
-- transient NOAA outage. Older-than-90-day events get vacuumed by a
-- weekly cleanup (deferred to Phase 3).

BEGIN;

CREATE TABLE IF NOT EXISTS storm_events (
  id                bigint        PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- NCDC event-id is a stable upstream key. Use it for idempotent
  -- insert-or-skip on cron re-runs.
  event_id          text          NOT NULL,
  event_type        text          NOT NULL,         -- "Hail", "Tornado", "Thunderstorm Wind", etc.
  state             varchar(2)    NOT NULL,
  county            text,
  zip               varchar(10),
  begin_date        timestamptz   NOT NULL,
  end_date          timestamptz,
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  magnitude         numeric(8,2),                   -- inches for hail, mph for wind
  injuries_direct   int                  DEFAULT 0,
  deaths_direct     int                  DEFAULT 0,
  damage_property   bigint,                         -- USD
  damage_crops      bigint,                         -- USD
  narrative         text,                           -- NOAA event narrative (140-2k chars)
  source            text                 DEFAULT 'NOAA-NCDC',
  created_at        timestamptz   NOT NULL DEFAULT now(),

  -- Idempotency: NCDC event_id may have multiple geo-stamps. Constrain
  -- on (event_id, begin_date) so re-runs of the cron never duplicate.
  CONSTRAINT storm_events_unique_event UNIQUE (event_id, begin_date)
);

-- Hot index: state + zip + recency. Covers dashboard "did anything
-- happen near my territory in the last 7 days" queries.
CREATE INDEX IF NOT EXISTS idx_storm_events_state_zip_date
  ON storm_events (state, zip, begin_date DESC);

-- Type index: per-event-type queries (e.g., "all hail events nationwide
-- in the last 24h" for a roofer-alert blast).
CREATE INDEX IF NOT EXISTS idx_storm_events_type_date
  ON storm_events (event_type, begin_date DESC);

-- Recency hint: originally a partial index `WHERE begin_date > now() -
-- interval '30 days'`, but Postgres rejects `now()` in index predicates
-- (42P17 — must be IMMUTABLE; `now()` is STABLE). The full btree on
-- `begin_date DESC` from line 67-68 already serves the "last 30 days"
-- dashboard query efficiently with a range scan — Postgres tail-scans
-- a few thousand rows for the recent window. The partial index would
-- have been a 5-10% win at best; not worth working around the
-- IMMUTABLE constraint via a daily cron that drops/recreates the
-- index. Drop the partial — keep the full btree.

ALTER TABLE storm_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'storm_events'
      AND policyname = 'storm_events_select_auth'
  ) THEN
    -- All authenticated users can read. Storm events are public-record
    -- data; the wedge-protection layer is at the lead-claim level, not
    -- the event level.
    CREATE POLICY storm_events_select_auth ON storm_events
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Writes are service-role only (cron). No INSERT/UPDATE policy granted
-- to authenticated.

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate (preferred)
--   OR paste into Supabase web SQL editor.
--
-- Verify:
--   SELECT count(*) FROM storm_events;
-- Should return 0 immediately after apply; populated by cron.
