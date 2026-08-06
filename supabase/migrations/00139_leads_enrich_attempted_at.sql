-- 00139_leads_enrich_attempted_at.sql
-- 2026-08-06 — lets the enrichment queue actually drain.
--
-- ─── What is wrong ──────────────────────────────────────────────────────
-- /api/cron/enrich picks candidates with
--
--     .is("year_built", null)
--     .not("address","is",null)
--     .limit(BATCH_SIZE)
--
-- and nothing else: no ordering, no cursor, no record of what was already
-- tried. The UPDATE was additionally gated on the patch being non-empty, so
-- a lead that yielded nothing was written to by nothing, still matched the
-- identical filter, and came back on the very next run.
--
-- That is not a rare tail. The priority half of each batch is the claimed
-- territories, whose county lookup (Hillsborough FL) publishes no year_built
-- at all, and Regrid — the only other year_built source — no-ops without
-- REGRID_API_KEY. So `year_built IS NULL` is permanent for essentially every
-- lead in the paying territory: the same head rows were re-fetched on all
-- four daily invocations, forever, and once the first pass had written what
-- it could every later pass produced an empty patch and no write at all.
-- Leads further down the ~295k corpus were never reached, and free county
-- and OSM endpoints received byte-identical repeated requests several times
-- a day.
--
-- ─── The fix ────────────────────────────────────────────────────────────
-- A per-row "we tried this" stamp, written for every lead the cron TOUCHES
-- regardless of whether it yielded a field. The cron then excludes recently
-- attempted leads, so each run walks forward into leads it has not examined
-- instead of re-grinding the same head.
--
-- Re-attempting is still allowed, just not four times a day: county and
-- parcel records do get corrected upstream, and Henri keeps adding sources,
-- so a lead that yielded nothing today may yield next month. The cron owns
-- the retry window (30 days, matching the re-enrich cron's staleness
-- threshold); this migration only provides the column.
--
-- ─── Why a new column rather than last_enriched_at ──────────────────────
-- `leads.last_enriched_at` (00051) is the re-enrich cron's staleness clock:
-- it drives a DIFFERENT eligibility rule (missing contact fields, 30-day
-- window). Writing it from this cron too would silently suppress re-enrich
-- for every lead the inflow cron touches, coupling two schedules that were
-- deliberately separated. A dedicated column keeps each cron's queue its
-- own, and either can be reverted without disturbing the other.
--
-- ─── Why a timestamp rather than a boolean ──────────────────────────────
-- A boolean answers "was it tried" but not "how long ago", so the retry
-- window would need a second column. A timestamp carries both, and NULL
-- means "never attempted" — exactly the set the cron should prefer.
--
-- The first index is PARTIAL on the null case because that is the hot
-- predicate, and it mirrors 00114's shape (zip, score DESC) so the priority
-- scan keeps the index path 00114 was created to give it. Rows leave the
-- index as they are attempted, so it shrinks as the backlog drains.
--
-- Additive and idempotent. Rollback at the bottom.

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS enrich_attempted_at timestamptz;

COMMENT ON COLUMN public.leads.enrich_attempted_at IS
  'When /api/cron/enrich last ATTEMPTED this lead, set whether or not any field was produced. NULL = never attempted. Lets the cron skip leads it has already tried instead of re-selecting the same unproductive head four times a day. See 00139.';

-- Never-attempted leads are what the cron reaches for first. Column order
-- matches 00114 so the territory-scoped scan still gets rows back already
-- score-ordered within each ZIP.
CREATE INDEX IF NOT EXISTS idx_leads_enrich_never_attempted
  ON public.leads (zip, score DESC)
  WHERE year_built IS NULL
    AND address IS NOT NULL
    AND enrich_attempted_at IS NULL;

-- Retry-window scans (the `enrich_attempted_at < cutoff` arm) read this one.
CREATE INDEX IF NOT EXISTS idx_leads_enrich_attempted_at
  ON public.leads (enrich_attempted_at)
  WHERE enrich_attempted_at IS NOT NULL;

COMMIT;

-- Fresh statistics for the new indexes. A stale visibility map on this table
-- has previously forced heap fetches on every enrichment scan (see the
-- 2026-08-04 landing-stats work), so do not skip this.
ANALYZE public.leads;

-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS public.idx_leads_enrich_attempted_at;
--   DROP INDEX IF EXISTS public.idx_leads_enrich_never_attempted;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS enrich_attempted_at;
