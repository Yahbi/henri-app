-- 00072_swdi_hail_precision_fix.sql
-- Wave 1.5 fix to ~/.claude/plans/whats-the-14-days-purring-papert.md.
--
-- Problem: weather_swdi_hail.lat / lng were declared numeric(8, 5),
-- which rounds to ~1.1 m precision. NOAA SWDI ships radar pixels at
-- ~250 m × 250 m, but the same RADAR cell scanned twice in a 6-min
-- window produces two SHAPE points that differ by 0.0001° (~11 cm)
-- — the 5-decimal precision collapses both to the same lat/lng AND
-- the unique index (event_time, lat, lng) absorbs all but ~1,000
-- of the 33k+ daily events as duplicates.
--
-- Fix: bump precision to numeric(10, 7) (~11 mm), drop and recreate
-- the unique index so future inserts get full precision. Existing
-- 1,000 rows are preserved (5-decimal values fit cleanly in 7-decimal
-- columns, just zero-padded).
--
-- Idempotent + additive — re-runs are safe.

BEGIN;

-- 1. Drop the unique index (it's keyed on the OLD (8,5) values so we
--    rebuild it after the column type change).
DROP INDEX IF EXISTS public.uq_swdi_hail_event;

-- 2. Bump precision. PostgreSQL allows widening numeric type without
--    a rewrite when the new type is a strict superset.
ALTER TABLE public.weather_swdi_hail
  ALTER COLUMN lat TYPE numeric(10, 7),
  ALTER COLUMN lng TYPE numeric(10, 7);

-- 3. Recreate the unique index at the new precision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_hail_event
  ON public.weather_swdi_hail (event_time, lat, lng);

-- 4. Same precision bump for wind / tornado for consistency — they
--    have the same SHAPE-WKT input and same dedup risk.
DROP INDEX IF EXISTS public.uq_swdi_wind_event;
ALTER TABLE public.weather_swdi_wind
  ALTER COLUMN lat TYPE numeric(10, 7),
  ALTER COLUMN lng TYPE numeric(10, 7);
CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_wind_event
  ON public.weather_swdi_wind (event_time, lat, lng);

DROP INDEX IF EXISTS public.uq_swdi_tornado_event;
ALTER TABLE public.weather_swdi_tornado
  ALTER COLUMN lat TYPE numeric(10, 7),
  ALTER COLUMN lng TYPE numeric(10, 7);
CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_tornado_event
  ON public.weather_swdi_tornado (event_time, lat, lng);

COMMIT;

-- After applying:
--   The next /api/cron/swdi-events run should insert >>1,000 hail
--   rows (expected ~33k/day). Verify via:
--     SELECT count(*) FROM weather_swdi_hail WHERE ingested_at > now() - interval '24h';
