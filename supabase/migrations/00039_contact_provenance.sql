-- 00039_contact_provenance.sql
-- Add contact provenance metadata to `permits` and `leads`.
--
-- Motivation: after the 2026-04-22 backfill we are writing applicant /
-- owner / phone / email into the denormalized columns, but we have no
-- way to answer "where did this contact value come from?" or "how
-- confident are we in it?". Without that, the dashboard can't show
-- transparent sourcing badges and the scoring engine can't weight
-- `contact_completeness` by the confidence of each signal.
--
-- Three new columns on BOTH tables:
--   contact_source        text          - which extractor / upstream feed produced this contact
--   contact_confidence    numeric(3,2)  - 0.00-1.00 heuristic quality score
--   contact_extracted_at  timestamptz   - when we last wrote contact data
--
-- Additive-only. All three default NULL — nothing existing reads these
-- columns yet, so the feature-flag-before-migration contract is already
-- satisfied (see `src/lib/ingest/extract-contact.ts` where the new
-- provenance-aware extractor was shipped first).
--
-- No indexes: these are metadata for display + audit, not query filters.

BEGIN;

ALTER TABLE permits
  ADD COLUMN IF NOT EXISTS contact_source        text,
  ADD COLUMN IF NOT EXISTS contact_confidence    numeric(3,2),
  ADD COLUMN IF NOT EXISTS contact_extracted_at  timestamptz;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_source        text,
  ADD COLUMN IF NOT EXISTS contact_confidence    numeric(3,2),
  ADD COLUMN IF NOT EXISTS contact_extracted_at  timestamptz;

COMMIT;
