-- 00044_leads_enrichment_columns.sql
-- Add columns the new enrichment orchestrator can populate.
--
-- Background: as of 2026-04-24 the orchestrator (`src/lib/enrichment/
-- orchestrator.ts`) composes 13 free sources. Several of them return
-- contact / business attributes the `leads` table doesn't currently
-- have a column for, so the data is computed but discarded:
--
--   - `employer`           — FEC contributor disclosure
--   - `occupation`         — FEC contributor disclosure
--   - `business_phone`     — distinct from owner phone (CSLB / Google
--                             / Yelp / PPP); the contractor's number,
--                             not the homeowner's
--   - `business_status`    — Google Places / Yelp ("OPERATIONAL" /
--                             "CLOSED_TEMPORARILY" / "CLOSED_PERMANENTLY")
--   - `license_number`     — CSLB CA license #
--   - `license_status`     — CSLB / state licensing board status
--   - `naics_code`         — PPP NAICS classification (drives industry
--                             segmentation in scoring + outreach)
--   - `business_website`   — Google Places / Yelp / OSM
--
-- All additive, all NULL by default. Zero impact on existing rows.
-- Existing UI continues to work; the new fields render only when the
-- LeadDetailDrawer's enrichment section is updated to read them.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS employer          text,
  ADD COLUMN IF NOT EXISTS occupation        text,
  ADD COLUMN IF NOT EXISTS business_phone    text,
  ADD COLUMN IF NOT EXISTS business_status   text,
  ADD COLUMN IF NOT EXISTS business_website  text,
  ADD COLUMN IF NOT EXISTS license_number    text,
  ADD COLUMN IF NOT EXISTS license_status    text,
  ADD COLUMN IF NOT EXISTS naics_code        text;

-- No new indexes — these are display-only columns. Add an index later
-- if scoring / segmentation queries start filtering on them.

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
-- pnpm migrate         (preferred)
-- OR paste into the Supabase SQL editor.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'leads'
--     AND column_name IN ('employer','occupation','business_phone',
--                         'business_status','business_website',
--                         'license_number','license_status','naics_code');
-- Should return 8 rows.
