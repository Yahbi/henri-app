-- 00114 — unblock the enrichment cron (statement timeout).
--
-- BUG (found 2026-08-04, live): POST /api/admin/data-health/trigger
-- {cron_path:'enrich'} returned 500 "canceling statement due to statement
-- timeout". Enrichment could not run at all — only ~1.1% of leads have ever
-- been enriched (565 of a 50,000 sample), which is why phone fill sits at
-- 0.9% and email at 0.002%.
--
-- ROOT CAUSE: the territory-scoped priority query in the enrich cron is
--   WHERE zip IN (<claimed zips>) AND year_built IS NULL AND address IS NOT NULL
--   ORDER BY score DESC
--   LIMIT 1200
-- No index covers that filter+sort, so Postgres walks idx_leads_score (score
-- DESC over the WHOLE table) and discards non-matching rows. Measured: finding
-- 50 matches scanned 1,189 rows (~24:1). At BATCH_SIZE=1200 that is ~28,000
-- rows scanned, well past PostgREST's 8 s authenticator statement_timeout.
-- The cost scales with how dense the claimed ZIPs are, so it got worse the
-- moment a high-volume ZIP (06106, ~12.5k leads) was claimed.
--
-- FIX: a partial composite index matching the query exactly. Postgres can then
-- index-scan each ZIP in score order and merge, instead of scanning the global
-- score index. Partial (year_built IS NULL AND address IS NOT NULL) keeps it
-- small — it only covers rows that are actually enrichment candidates, and
-- rows drop out of the index as they get enriched.
--
-- Idempotent; safe to re-run.

CREATE INDEX IF NOT EXISTS idx_leads_enrich_priority
  ON public.leads (zip, score DESC)
  WHERE year_built IS NULL AND address IS NOT NULL;

-- Keep planner statistics fresh for the new index. A restore leaves stats
-- NULL, which on 2026-08-04 caused app-wide statement timeouts until an
-- explicit ANALYZE was run.
ANALYZE public.leads;
