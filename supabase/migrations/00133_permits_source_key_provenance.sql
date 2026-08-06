-- 00133_permits_source_key_provenance.sql
-- 2026-08-06 — records WHICH source produced each permit.
--
-- ─── What is broken ─────────────────────────────────────────────────────
-- 110,484 of 239,888 enabled rows in `permit_sources` (46%) have a blank
-- `city`. The scrapers build their identifiers from that field:
--
--     source_id:   `${source.city.toLowerCase().replace(/\s+/g,"_")}_${rawId}`
--     source_city: source.city
--     upsert conflict target: (source_city, source_id)
--
-- so a blank city yields source_city='' and source_id='_<rawId>', and ALL
-- 110k of those sources land in a single shared namespace. Measured today:
-- 952,376 permits carry source_city='', which is 56% of the last 6 hours of
-- ingest.
--
-- Two costs. The first is already being paid: those 952k permits cannot be
-- attributed to the feed that produced them, so a source publishing garbage
-- cannot be identified, and the data-health page cannot group by origin.
--
-- The second has not been paid yet, and only by luck. Dedup for every one of
-- those sources rests on upstream ids being globally unique ACROSS sources.
-- Today that holds — 952,376 rows, 952,376 distinct source_ids, zero
-- collisions — because the feeds in question use GUIDs or long numeric keys.
-- Two ArcGIS layers both numbering OBJECTID 1, 2, 3 would silently overwrite
-- each other's permits, and nothing would report it.
--
-- ─── Why this migration does NOT fix the namespace ──────────────────────
-- The obvious repair — backfill permit_sources.city, or key on something
-- else — changes source_city and/or source_id, which ARE the upsert conflict
-- target. Every existing permit would stop matching its own row and be
-- re-inserted on the next scrape. That is ~952k duplicates, in a table with
-- no cheap way to tell the copies apart. The cure is worse than the disease,
-- so this migration deliberately leaves the conflict key untouched.
--
-- ─── What it does instead ───────────────────────────────────────────────
-- Adds `source_key`, a column that is NOT part of any unique constraint, so
-- writing it cannot change which row an upsert matches. New and re-scraped
-- permits start carrying the registry key of the feed that produced them,
-- which restores attribution with zero duplication risk.
--
-- ─── The safe path to fixing the namespace, later ───────────────────────
-- Once source_key is populated across the corpus (it fills naturally as the
-- rotation re-scrapes, or can be backfilled per-source in bounded chunks):
--   1. add a unique index on (source_key, source_id) CONCURRENTLY
--   2. dual-write for one release so both keys are populated and agree
--   3. move the scrapers' onConflict to (source_key, source_id)
--   4. drop the old constraint
-- That sequence never leaves the table without a working conflict target,
-- which is the property the naive fix loses.
--
-- Additive and idempotent. Rollback at the bottom.

BEGIN;

ALTER TABLE public.permits
  ADD COLUMN IF NOT EXISTS source_key text;

COMMENT ON COLUMN public.permits.source_key IS
  'Registry key (permit_sources.source_key) of the feed that produced this row. Provenance only — deliberately NOT part of any unique constraint, because the upsert conflict target is (source_city, source_id) and changing it would re-insert every existing permit as a duplicate. See 00133.';

-- Partial: only the populated rows are worth indexing, and the column is
-- NULL for the whole historical corpus until the rotation refills it.
CREATE INDEX IF NOT EXISTS idx_permits_source_key
  ON public.permits (source_key)
  WHERE source_key IS NOT NULL;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.idx_permits_source_key;
--   ALTER TABLE public.permits DROP COLUMN IF EXISTS source_key;
