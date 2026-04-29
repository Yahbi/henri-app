-- 00055_lead_property_context_views.sql
-- Phase 0 of free-tier data expansion: surface dormant property context.
--
-- Adds two read-only views that compose data already in the database into
-- contractor-actionable signals that don't currently surface anywhere.
-- Pure additive — no schema changes, no RLS changes, no scoring changes.
-- Existing wedge logic is untouched; the views are additional context
-- the LeadDetailDrawer reads via /api/leads/[id]/context.
--
-- ## v_permit_adjacent_count
--
-- For each permit, count of OTHER permits filed in the same ZIP within
-- 90 days before the permit's filed date. Drives the "neighborhood reno
-- wave" signal — when 5+ neighbors are remodeling, your lead is part of
-- a documented wave (powerful outreach hook + social-proof opener).
--
-- Indexed against `idx_permits_zip` (existing) + applied_date scan;
-- evaluated lazily on view access (Postgres re-runs the join on each
-- read). Cached at the API layer (30s edge cache, see route handler).
--
-- ## v_permit_storm_proximity
--
-- For each permit, the MOST RECENT storm_event in same ZIP within 60
-- days BEFORE the permit was filed. Storm-damage detection: a roof
-- permit filed 14 days after a hail event is overwhelmingly likely to
-- be insurance-driven, and the contractor knows to lead with insurance-
-- claim language.
--
-- Joins permits.zip → storm_events.zip + temporal range. Storm_events
-- table already has idx_storm_events_state_zip_date (migration 00050)
-- so the join is index-supported.
--
-- ## Why views and not materialized views?
--
-- 925k permits × neighborhood-permit count = 50M+ row materialized
-- view. The on-demand pattern (one lead at a time, drawer-triggered)
-- means we read ~10-100 rows per query. Postgres can satisfy that
-- through the existing indexes in <50ms — materialization is overkill
-- and adds storage + refresh complexity.
--
-- ## RLS / security
--
-- Views inherit RLS from base tables. permits + storm_events are both
-- already public-read for authenticated users. No new policy needed.
--
-- ## Rollback
--
-- DROP VIEW IF EXISTS v_permit_storm_proximity;
-- DROP VIEW IF EXISTS v_permit_adjacent_count;

BEGIN;

-- ── Adjacent-permit count ──────────────────────────────────────────
--
-- Counts neighbors. Returns one row per permit with the count of
-- OTHER permits filed in the same ZIP within the 90 days before the
-- permit's applied_date. Self-excluded via id != id.

CREATE OR REPLACE VIEW v_permit_adjacent_count AS
SELECT
  p.id                AS permit_id,
  p.zip,
  p.applied_date,
  COALESCE((
    SELECT COUNT(*)::int
    FROM permits p2
    WHERE p2.zip = p.zip
      AND p2.id <> p.id
      AND p2.applied_date IS NOT NULL
      AND p.applied_date IS NOT NULL
      AND p2.applied_date >= (p.applied_date - INTERVAL '90 days')
      AND p2.applied_date <= p.applied_date
  ), 0)               AS adjacent_count_90d;

COMMENT ON VIEW v_permit_adjacent_count IS
  'Count of other permits filed in same ZIP within 90 days BEFORE the
  given permit''s applied_date. Used by /api/leads/[id]/context for
  the neighborhood-activity drawer signal.';

-- ── Storm proximity ────────────────────────────────────────────────
--
-- For each permit, the most recent storm_event in same ZIP within
-- 60 days BEFORE the permit was filed. DISTINCT ON gives us a single
-- row per permit (the latest matching storm).

CREATE OR REPLACE VIEW v_permit_storm_proximity AS
SELECT DISTINCT ON (p.id)
  p.id                                                              AS permit_id,
  se.event_id                                                       AS storm_event_id,
  se.event_type                                                     AS storm_type,
  se.begin_date                                                     AS storm_date,
  se.magnitude                                                      AS storm_magnitude,
  GREATEST(0, EXTRACT(DAY FROM (p.applied_date - se.begin_date))::int)
                                                                    AS days_between
FROM permits p
JOIN storm_events se
  ON se.zip = p.zip
 AND p.applied_date IS NOT NULL
 AND se.begin_date BETWEEN (p.applied_date - INTERVAL '60 days')
                       AND p.applied_date
ORDER BY p.id, se.begin_date DESC;

COMMENT ON VIEW v_permit_storm_proximity IS
  'Most recent storm event in same ZIP within 60 days BEFORE the
  permit was filed. Used by /api/leads/[id]/context for the storm-
  proximity drawer chip — strong signal for roofing / siding / window
  contractors that the project is insurance-driven.';

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate (preferred)
--   OR paste into Supabase web SQL editor.
--
-- Verify:
--   SELECT permit_id, adjacent_count_90d FROM v_permit_adjacent_count
--     WHERE adjacent_count_90d > 0 LIMIT 5;
--   SELECT permit_id, storm_type, storm_date, days_between
--     FROM v_permit_storm_proximity LIMIT 5;
--
-- Both should return rows when permits + storm_events tables are
-- populated. Empty result on a fresh DB is expected.
