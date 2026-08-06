-- 00134_permits_geocode_attempted_at.sql
-- 2026-08-06 — lets the ZIP backfill actually drain.
--
-- ─── What is wrong ──────────────────────────────────────────────────────
-- /api/cron/census-geocode selects candidates with
--
--     .or("latitude.is.null,zip.is.null")
--     .not("address","is",null)
--     .limit(fetchSize)
--
-- and nothing else. There is no ordering and no record of what was already
-- tried, so every run re-reads the same head of the same filtered set. A
-- permit Census cannot match — a rural route, a PO box, a malformed street —
-- is sent again on the very next run, and again forever, occupying a slot
-- that a matchable permit could have used.
--
-- That is why hourly cadence did not fix the backlog it was introduced for:
-- 1,331,386 permits still lack a ZIP, and each run spends part of its 5,000-row
-- budget re-attempting rows that have already failed.
--
-- ─── The fix ────────────────────────────────────────────────────────────
-- A per-row "we tried this" stamp, written for every id SENT to Census
-- regardless of whether it matched. The cron then excludes recently-attempted
-- rows, so each run walks forward into genuinely unexamined permits instead
-- of re-grinding the same head.
--
-- Re-attempting is still allowed, just not hourly: addresses do get corrected
-- upstream and Census updates its own coverage, so a row that failed today may
-- match next quarter. The cron applies the retry window; this migration only
-- provides the column.
--
-- ─── Why a timestamp rather than a boolean ──────────────────────────────
-- A boolean answers "was it tried" but not "how long ago", so the retry
-- window would need a second column. A timestamp carries both, and NULL means
-- "never attempted" — which is exactly the set the cron should prefer.
--
-- The index is PARTIAL on the null case because that is the hot predicate:
-- the cron wants never-attempted rows first, and those are a shrinking subset
-- of a 2.8M-row table.
--
-- Additive and idempotent. Rollback at the bottom.

BEGIN;

ALTER TABLE public.permits
  ADD COLUMN IF NOT EXISTS geocode_attempted_at timestamptz;

COMMENT ON COLUMN public.permits.geocode_attempted_at IS
  'When this permit was last SENT to the Census batch geocoder, set whether or not it matched. NULL = never attempted. Lets /api/cron/census-geocode skip rows it has already tried instead of re-sending the same unmatchable head every hour. See 00134.';

-- Never-attempted rows are what the cron reaches for first.
CREATE INDEX IF NOT EXISTS idx_permits_geocode_never_attempted
  ON public.permits (id)
  WHERE geocode_attempted_at IS NULL;

-- Retry-window scans read this one.
CREATE INDEX IF NOT EXISTS idx_permits_geocode_attempted_at
  ON public.permits (geocode_attempted_at)
  WHERE geocode_attempted_at IS NOT NULL;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.idx_permits_geocode_attempted_at;
--   DROP INDEX IF EXISTS public.idx_permits_geocode_never_attempted;
--   ALTER TABLE public.permits DROP COLUMN IF EXISTS geocode_attempted_at;
