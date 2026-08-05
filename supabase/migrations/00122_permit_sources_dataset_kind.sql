-- 00122_permit_sources_dataset_kind.sql
--
-- Explicit dataset classification for `permit_sources`.
--
-- WHY
-- ---
-- The registry has no way to say "this row is not a permit feed". Roughly
-- 2,642 ENABLED rows point at business-licence registries, sewer-wye
-- inventories, wetland layers and building-footprint layers. They scrape
-- cleanly, their rows land in `public.permits`, and they inflate the permit
-- count the marketing site reports — which the truthfulness rule forbids.
--
-- Until now the only defence was `looksLikeNonPermitDataset()` in
-- src/lib/scrapers/types.ts, a payload heuristic re-run on EVERY scrape of
-- EVERY source, forever, whose verdict was thrown away at the end of the run.
-- The verdict belongs in the registry: decided once, from evidence, and
-- readable by every consumer without a network round trip.
--
-- SEMANTICS (deliberately narrow — see the COMMENTs below)
--   'unknown'    — never probed. Default for all 12k existing rows.
--   'permit'     — a probe fetched a sample row / field schema and found NO
--                  non-permit marker. This is a PASSED SCREEN, not a human
--                  verification. `field_mapping_status` already carries the
--                  'probed' vs 'verified' distinction for the mapping itself;
--                  a 'verified_permit' value can be added here later if a
--                  human review lane ever exists.
--   'non_permit' — a probe found positive evidence the payload is something
--                  else (licence number, wye number, wetland type, ...).
--                  /api/cron/activate-arcgis-sources refuses to enable these
--                  and the scrape rotation skips them.
--
-- READ PATH IS FEATURE-FLAGGED. src/lib/scrapers/sources-db.ts detects a
-- missing column (SQLSTATE 42703) and re-runs its queries without the filter,
-- so the app behaves correctly whether or not this migration has been applied.
--
-- Additive + idempotent. `ADD COLUMN ... DEFAULT` is catalog-only on PG11+,
-- so no table rewrite even at 240k rows.
--
-- OPERATOR NOTE: the index at the bottom takes a SHARE lock on
-- `permit_sources` for the duration of the build. Apply when the instance is
-- NOT under I/O pressure. If it is, run the CONCURRENTLY variant noted below
-- on its own, outside this transaction.

BEGIN;

ALTER TABLE public.permit_sources
  ADD COLUMN IF NOT EXISTS dataset_kind            text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS dataset_kind_reason     text,
  ADD COLUMN IF NOT EXISTS dataset_kind_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permit_sources_dataset_kind_chk'
  ) THEN
    ALTER TABLE public.permit_sources
      ADD CONSTRAINT permit_sources_dataset_kind_chk
      CHECK (dataset_kind IN ('unknown', 'permit', 'non_permit'));
  END IF;
END$$;

COMMENT ON COLUMN public.permit_sources.dataset_kind IS
  'What the endpoint actually serves. ''unknown'' = never probed. ''permit'' = a sample payload passed the non-permit screen (looksLikeNonPermitDataset) — a passed screen, NOT a human verification. ''non_permit'' = positive evidence of a licence / utility / footprint / wetland layer; never enable, never scrape.';
COMMENT ON COLUMN public.permit_sources.dataset_kind_reason IS
  'Operator-facing evidence for the current dataset_kind — the marker column that disqualified the payload. NULL when the source has not been probed or passed cleanly.';
COMMENT ON COLUMN public.permit_sources.dataset_kind_checked_at IS
  'When the classification was last decided. A NULL here next to a non-''unknown'' dataset_kind means the value was set by hand rather than by a probe.';

-- Supports the activation cron's candidate query:
--   WHERE enabled = false AND source_type = 'arcgis'
--     AND dataset_kind <> 'non_permit' AND error_count < 10
--   ORDER BY error_count, jurisdiction
--
-- CONCURRENTLY variant, if the SHARE lock is unacceptable (run alone, no txn):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_permit_sources_activation_candidates
--     ON public.permit_sources (source_type, error_count, jurisdiction)
--     WHERE enabled = false AND dataset_kind <> 'non_permit';
CREATE INDEX IF NOT EXISTS idx_permit_sources_activation_candidates
  ON public.permit_sources (source_type, error_count, jurisdiction)
  WHERE enabled = false AND dataset_kind <> 'non_permit';

COMMIT;
