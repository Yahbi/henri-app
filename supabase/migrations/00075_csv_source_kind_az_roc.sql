-- 00075_csv_source_kind_az_roc.sql
-- Adds 'csv' to the contractor_license_sources.source_kind allow-list
-- and re-enables AZ ROC with its dated daily CSV URL pattern.
--
-- The /api/cron/state-licenses-rotate route now supports csv-source
-- with `${YYYY-MM-DD}` placeholder in endpoint_url — the rotator tries
-- today's UTC date first, then falls back through the previous 7 days
-- if the file 404s (covers weekends / holidays where AZ ROC skips).
--
-- Probed 2026-05-01 with a Mozilla user agent and confirmed the
-- 12 MB CSV at:
--   https://roc.az.gov/sites/default/files/ROC_Posting-List_${YYYY-MM-DD}.csv
-- returns HTTP 200 with the canonical column shape (License No,
-- Business Name, DBA, Class, Address, City, ZIP, Issued Date,
-- Expiration Date, Status, Qualifying Party).
--
-- Note: AZ ROC publishes hyphenated dated files. URLs have been
-- 200-OK on Cloudflare with the Mozilla UA the rotator already sets.
-- If they tighten the bot wall later, we'll add a Playwright fallback.
--
-- Idempotent + additive.

BEGIN;

-- Drop the old constraint and re-create with 'csv' added.
ALTER TABLE public.contractor_license_sources
  DROP CONSTRAINT IF EXISTS contractor_license_sources_source_kind_check;

ALTER TABLE public.contractor_license_sources
  ADD CONSTRAINT contractor_license_sources_source_kind_check
  CHECK (source_kind IN ('socrata', 'arcgis', 'csv', 'scrape'));

-- Re-enable AZ ROC with the verified-live dated CSV URL.
UPDATE public.contractor_license_sources SET
  source_kind  = 'csv',
  endpoint_url = 'https://roc.az.gov/sites/default/files/ROC_Posting-List_${YYYY-MM-DD}.csv',
  field_map    = '{
    "license_number": "license_no",
    "business_name":  "business_name",
    "license_type":   "class",
    "license_status": "status",
    "issue_date":     "issued_date",
    "expire_date":    "expiration_date",
    "city":           "city",
    "zip":            "zip"
  }'::jsonb,
  enabled = true,
  notes   = 'AZ ROC daily Posting-List CSV. URL has ${YYYY-MM-DD} placeholder; rotator tries today, falls back through last 7 days. Verified live 2026-05-01 (12 MB, Mozilla UA required to bypass Cloudflare bot wall).',
  updated_at = now()
WHERE state_code = 'AZ';

COMMIT;

-- Verify:
--   SELECT state_code, source_kind, enabled, endpoint_url
--     FROM contractor_license_sources WHERE state_code='AZ';
-- Should show source_kind='csv', enabled=true.
