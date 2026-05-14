-- ─────────────────────────────────────────────────────────────────────
-- 00083 · 10 net-new public_bulk state contractor-license rosters.
--
-- Adds OH · CO · VA · MN · TN · IA · AR · AK · UT · ID to the existing
-- registry (TX/NY/WA/OR/AZ already live since migration 00074).
--
-- Source: research/tier3_license_rosters.md (2026-05-07 audit). Each
-- field_map mirrors the upstream column-name convention discovered by
-- the research agent. Field-maps may need 1-2 hours of tuning per
-- state during first ingest — recommend running the rotator with a
-- DRY_RUN flag the first time so column-mismatches surface as logs
-- instead of failed inserts.
--
-- Re-uses source_kind values 'socrata' / 'csv' / 'scrape' (defined in
-- 00073/00075). 'scrape' covers state portals that emit CSV/XLSX from
-- a one-shot HTTP request but require form-state or a custom URL
-- builder (not a static-URL CSV).
--
-- Idempotent: ON CONFLICT (state_code) DO UPDATE so re-running this
-- migration after a row-tuning-pass is safe.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO public.contractor_license_sources
  (state_code, state_name, source_kind, endpoint_url, field_map, enabled, notes)
VALUES
  ('OH', 'Ohio', 'scrape',
   'https://elicense4.com.ohio.gov/Lookup/DownloadRoster.aspx',
   '{"license_number":"License Number","name":"Business Name","license_type":"License Type","license_status":"Status","expiry":"Expiration Date","city":"City","state":"State","zip":"Zip"}'::jsonb,
   true,
   'OCILB roster generator. POST a license_type, get an XLSX. Trades-only (no GC).'),

  ('CO', 'Colorado', 'socrata',
   'https://data.colorado.gov/resource/7s5z-vewr.json',
   '{"license_number":"license_number","name":"licensee_first_name","name_business":"licensee_business_name","license_type":"profession","license_status":"license_status","expiry":"license_expiration_date","issue_date":"original_license_date"}'::jsonb,
   true,
   'CO DORA. 1M+ rows; filter $where=profession in (...) for trades. No state GC.'),

  ('VA', 'Virginia', 'scrape',
   'https://www.dpor.virginia.gov/RegulantLists',
   '{"license_number":"License Number","name":"Business Name","license_type":"Specialty","license_status":"Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'DPOR static tab-delimited TXT files per profession. Concatenate Class A/B/C + EHV + plumb.'),

  ('MN', 'Minnesota', 'scrape',
   'https://www.dli.mn.gov/license-and-registration-lookup',
   '{"license_number":"License Number","name":"Licensee Name","license_type":"License Type","license_status":"Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'DLI nightly XLSX. Single sheet for all CCLD trades.'),

  ('TN', 'Tennessee', 'scrape',
   'https://www.tn.gov/commerce/regboards/contractors/consumer/verify-qa.html',
   '{"license_number":"License Number","name":"Business Name","license_type":"Classification","license_status":"License Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'TN BLC public dashboard. CSV export linked from page.'),

  ('IA', 'Iowa', 'socrata',
   'https://data.iowa.gov/resource/dpf3-iz94.json',
   '{"license_number":"registration_number","name":"business_name","license_status":"registration_status","expiry":"expiration_date","issue_date":"issue_date"}'::jsonb,
   true,
   'data.iowa.gov "Active Iowa Construction Contractor Registrations". Drop-in.'),

  ('AR', 'Arkansas', 'csv',
   'http://aclb2.arkansas.gov/latestroster.csv',
   '{"license_number":"License #","name":"Contractor Name","license_type":"License Type","license_status":"Status","expiry":"Expiration"}'::jsonb,
   true,
   'ACLB nightly static CSV. Simplest integration in the registry.'),

  ('AK', 'Alaska', 'csv',
   'https://www.commerce.alaska.gov/cbp/main/Search/Professional/Download',
   '{"license_number":"LicenseNumber","name":"LicenseName","license_type":"ProgramName","license_status":"Status","expiry":"DateExpire","issue_date":"DateIssued"}'::jsonb,
   true,
   'DCBPL full CSV dump. Filter ProgramName like Construction%.'),

  ('UT', 'Utah', 'csv',
   'https://secure.utah.gov/datarequest/professionals/index.html',
   '{"license_number":"LicenseNumber","name":"Name","license_type":"LicenseType","license_status":"Status","expiry":"ExpDate"}'::jsonb,
   true,
   'DOPL data-request portal. Free CSV. Filter LicenseType in CBR + electrical/plumbing.'),

  ('ID', 'Idaho', 'csv',
   'https://dopl.idaho.gov/license-search/',
   '{"license_number":"License Number","name":"Licensee Name","license_type":"License Type","license_status":"Status","expiry":"Expiration"}'::jsonb,
   true,
   'DOPL "Roster Download" CSV. ID Contractors Board licenses contractors >$2k/yr.')

ON CONFLICT (state_code) DO UPDATE
  SET source_kind  = EXCLUDED.source_kind,
      endpoint_url = EXCLUDED.endpoint_url,
      field_map    = EXCLUDED.field_map,
      enabled      = true,
      notes        = EXCLUDED.notes,
      updated_at   = now();

COMMIT;
