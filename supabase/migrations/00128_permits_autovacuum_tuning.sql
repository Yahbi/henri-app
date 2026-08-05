-- 00128_permits_autovacuum_tuning.sql
--
-- Make autovacuum actually run on `public.permits`.
--
-- ─── The finding ────────────────────────────────────────────────────────
-- Measured 2026-08-05 on the live table:
--
--   n_live_tup      2,255,945
--   n_dead_tup         73,082   (3.14%)
--   last_vacuum     2026-08-05 01:49  (a MANUAL vacuum)
--   last_autovacuum NULL              <-- has never run. not once.
--
-- The default `autovacuum_vacuum_scale_factor` is 0.2, i.e. autovacuum waits
-- until dead tuples reach 20% of the table. On 2.25M rows that is ~450,000
-- dead tuples. Normal operation here — a scrape pass, a re-score, a batched
-- repair — produces tens of thousands, never hundreds of thousands. So the
-- threshold is never reached and autovacuum never fires.
--
-- ─── Why that is expensive, not merely untidy ───────────────────────────
-- Dead tuples invalidate the visibility map, and without a clean visibility
-- map Postgres cannot do an INDEX-ONLY scan — it must visit the heap for
-- every candidate row. Measured on this exact table, same query, same day:
--
--   count(*) WHERE state = 'CA'
--     stale visibility map .... 94,907 ms   (Heap Fetches: 112,145)
--     right after VACUUM ...........89 ms   (Heap Fetches: 0)
--
-- That is a 1,000x swing on the query the marketing coverage cache is built
-- from, decided entirely by whether anyone happened to run VACUUM recently.
-- The same effect made `GROUP BY state` swing between 9.6s and 37.5s.
--
-- It also compounds: because autovacuum never ran, every batch of UPDATEs
-- left the table permanently slower than it found it, and the only remedy
-- was a human noticing and vacuuming by hand.
--
-- ─── The setting ────────────────────────────────────────────────────────
-- 0.01 = ~22,500 dead tuples on the current row count, which is a normal
-- working set rather than a crisis. The absolute thresholds stop it firing
-- constantly while the table is still small.
--
-- Analyze gets the same cadence: the per-state counts the coverage cache
-- depends on need accurate reltuples, and a stale planner estimate is what
-- pushed the planner onto a sequential scan in the first place.
--
-- This is metadata only — no rewrite, no lock beyond a brief
-- ShareUpdateExclusive. Note it WILL block behind a running VACUUM on the
-- same table, which is expected, not a failure.

ALTER TABLE public.permits SET (
  autovacuum_vacuum_scale_factor  = 0.01,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold     = 5000,
  autovacuum_analyze_threshold    = 5000
);

-- `leads` has the same shape of problem: 273k rows, re-scored in bulk by the
-- score cron, and its own count queries already trip the 8s statement
-- timeout when stats go stale (an exact count measured 8.8s, which is why
-- the coverage cache uses a planned count for it).
ALTER TABLE public.leads SET (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold     = 5000,
  autovacuum_analyze_threshold    = 5000
);

-- Verify:
--   SELECT relname, reloptions FROM pg_class
--    WHERE relname IN ('permits','leads');
--   SELECT relname, last_autovacuum, n_dead_tup FROM pg_stat_user_tables
--    WHERE relname IN ('permits','leads');
--
-- Rollback:
--   ALTER TABLE public.permits RESET (
--     autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor,
--     autovacuum_vacuum_threshold, autovacuum_analyze_threshold);
--   ALTER TABLE public.leads RESET (
--     autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor,
--     autovacuum_vacuum_threshold, autovacuum_analyze_threshold);
