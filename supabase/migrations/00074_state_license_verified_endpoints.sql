-- 00074_state_license_verified_endpoints.sql
-- Replaces the placeholder endpoints in 00073's seed with the 4
-- verified-live Socrata feeds confirmed by per-state probes on
-- 2026-05-01:
--
--   TX TDLR              data.texas.gov/resource/7358-krk7.json
--   NY (NYC DCWP)        data.cityofnewyork.us/resource/acd4-wkax.json
--   WA L&I               data.wa.gov/resource/m8qx-ubtq.json
--   OR CCB               data.oregon.gov/resource/g77e-6bhs.json
--
-- All 4 return 200 with sample rows containing license_number +
-- business_name + status + (most cases) phone/address. The
-- field_map jsonb maps our canonical schema → the upstream column
-- name so /api/cron/state-licenses-rotate normalizes correctly.
--
-- Disabled (no public bulk endpoint exists):
--   CA CSLB     ASP-postback search only — needs scraper, not a feed
--   FL DBPR     CSV download only — rotator only handles Socrata/ArcGIS
--   AZ ROC      Cloudflare-blocks anonymous UAs
--   IL IDFPR    PDF-only by profession
--
-- Idempotent: ON CONFLICT DO UPDATE keeps the table consistent
-- across re-runs.

BEGIN;

-- TX is a NEW row (not in the 00073 seed).
INSERT INTO public.contractor_license_sources
  (state_code, state_name, source_kind, endpoint_url, field_map, enabled, notes)
VALUES
  ('TX', 'Texas', 'socrata',
   'https://data.texas.gov/resource/7358-krk7.json',
   '{
      "license_number": "license_number",
      "business_name":  "business_name",
      "license_type":   "license_type",
      "license_status": "license_status",
      "expire_date":    "license_expiration_date_mmddccyy",
      "city":           "business_city",
      "state":          "business_state",
      "zip":            "business_zip",
      "phone":          "business_phone"
   }'::jsonb,
   true,
   'TDLR Texas Department of Licensing & Regulation - verified live 2026-05-01.')
ON CONFLICT (state_code) DO UPDATE
  SET source_kind  = EXCLUDED.source_kind,
      endpoint_url = EXCLUDED.endpoint_url,
      field_map    = EXCLUDED.field_map,
      enabled      = true,
      notes        = EXCLUDED.notes,
      updated_at   = now();

-- Repoint NY to NYC DCWP (state-level NY publishes nothing public).
UPDATE public.contractor_license_sources SET
  state_name   = 'New York (NYC DCWP)',
  endpoint_url = 'https://data.cityofnewyork.us/resource/acd4-wkax.json',
  field_map    = '{
    "license_number": "license_nbr",
    "license_type":   "license_type",
    "license_status": "license_status",
    "business_name":  "business_name",
    "city":           "address_city",
    "state":          "address_state",
    "zip":            "address_zip",
    "phone":          "contact_phone",
    "expire_date":    "lic_expir_dd"
  }'::jsonb,
  enabled = true,
  notes   = 'NYC DCWP Active Home Improvement Contractor Licenses - verified live 2026-05-01. NYC only - state-level NY has no public bulk endpoint.',
  updated_at = now()
WHERE state_code = 'NY';

-- WA — corrected URL: data.wa.gov (NOT data.lni.wa.gov which doesn't exist).
UPDATE public.contractor_license_sources SET
  endpoint_url = 'https://data.wa.gov/resource/m8qx-ubtq.json',
  field_map    = '{
    "license_number": "contractorlicensenumber",
    "license_type":   "contractorlicensetypecodedesc",
    "license_status": "contractorlicensestatus",
    "business_name":  "businessname",
    "city":           "city",
    "state":          "state",
    "zip":            "zip",
    "phone":          "phonenumber",
    "issue_date":     "licenseeffectivedate",
    "expire_date":    "licenseexpirationdate"
  }'::jsonb,
  enabled = true,
  notes   = 'WA L&I - richest contact data of the verified set. verified live 2026-05-01.',
  updated_at = now()
WHERE state_code = 'WA';

-- OR — corrected URL: g77e-6bhs (the original p8qe-4r2t was 404).
UPDATE public.contractor_license_sources SET
  endpoint_url = 'https://data.oregon.gov/resource/g77e-6bhs.json',
  field_map    = '{
    "license_number": "license_number",
    "license_type":   "license_type",
    "business_name":  "full_name",
    "city":           "city",
    "zip":            "zip_code",
    "phone":          "phone_number",
    "expire_date":    "lic_exp_date"
  }'::jsonb,
  enabled = true,
  notes   = 'OR CCB Active Licenses - verified live 2026-05-01. Includes bond carrier + bond amount in raw_json.',
  updated_at = now()
WHERE state_code = 'OR';

-- Disable & annotate the others — confirmed unreachable per
-- 2026-05-01 research probe.
UPDATE public.contractor_license_sources SET
  enabled = false,
  notes   = 'CA CSLB - ASP-postback search only, no public bulk JSON/CSV. Disabled until a scraper/Apify task is in place.',
  updated_at = now()
WHERE state_code = 'CA';

UPDATE public.contractor_license_sources SET
  enabled = false,
  notes   = 'FL DBPR - CSV-only at www2.myfloridalicense.com/sto/file_download/extracts/cilb_certified.csv. Rotator only handles Socrata/ArcGIS today; CSV-source kind is a follow-up.',
  updated_at = now()
WHERE state_code = 'FL';

UPDATE public.contractor_license_sources SET
  enabled = false,
  notes   = 'AZ ROC posting list at roc.az.gov/posting-list - Cloudflare blocks anonymous UAs. Disabled until browser-style fetch path or scraper.',
  updated_at = now()
WHERE state_code = 'AZ';

UPDATE public.contractor_license_sources SET
  enabled = false,
  notes   = 'IL IDFPR - PDF-only Active License Report by profession. No public bulk JSON/CSV endpoint exists.',
  updated_at = now()
WHERE state_code = 'IL';

COMMIT;

-- Verify:
--   SELECT state_code, enabled FROM contractor_license_sources ORDER BY enabled DESC, state_code;
-- Should show TX, NY, OR, WA = enabled; CA, FL, AZ, IL = disabled.
