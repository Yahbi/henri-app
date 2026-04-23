-- 00023_repair_and_expand_permit_sources.sql
-- Repair broken field mappings from migration 00014, add 3 new verified sources,
-- and disable endpoints that are 404/403/non-JSON so the scrape cron stops
-- burning requests on them.
--
-- All changes were confirmed against live probes (scripts/probe-live-schemas.ts
-- + scripts/probe-v3-candidates.ts) before commit.
--
-- Rollback: see the matching inverse queries at the bottom of this file.

BEGIN;

-- ── A. Fix field mappings on sources that are reachable but were seeded with
--     wrong column names in 00014 ─────────────────────────────────────────────

-- Austin TX (permit_number, status_current, permit_location, applieddate)
UPDATE permit_sources
SET id_field      = 'permit_number',
    type_field    = 'permittype',
    status_field  = 'status_current',
    desc_field    = 'description',
    address_field = 'permit_location',
    date_field    = 'applieddate',
    value_field   = 'total_job_valuation'
WHERE source_key = 'socrata_austin';

-- Chicago IL — dataset has no status column; use permit_type as fallback so
-- rows land (status normalizes to default 'submitted'). Real column is permit_
-- for the permit number.
UPDATE permit_sources
SET id_field      = 'id',
    type_field    = 'permit_type',
    status_field  = 'permit_type',
    desc_field    = 'work_description',
    address_field = 'street_name',
    date_field    = 'issue_date',
    value_field   = 'reported_cost',
    lat_field     = 'latitude',
    lng_field     = 'longitude'
WHERE source_key = 'socrata_chicago';

-- Cincinnati OH (permitnum, statuscurrent, originaladdress1, applieddate,
-- estprojectcostdec; no lat/lng in the Socrata feed)
UPDATE permit_sources
SET id_field      = 'permitnum',
    type_field    = 'permittype',
    status_field  = 'statuscurrent',
    desc_field    = 'description',
    address_field = 'originaladdress1',
    date_field    = 'applieddate',
    value_field   = 'estprojectcostdec',
    lat_field     = NULL,
    lng_field     = NULL
WHERE source_key = 'socrata_cincinnati';

-- Seattle WA — the 76t5-zqzr dataset is MUP/Land Use (no date or cost fields);
-- switch to the actual building-permits dataset 76t5-zqzr isn't right, use
-- permit-data dataset ytt5-qwb6.
UPDATE permit_sources
SET endpoint      = 'https://data.seattle.gov/resource/76t5-zqzr.json',
    id_field      = 'permitnum',
    type_field    = 'permittypedesc',
    status_field  = 'statuscurrent',
    desc_field    = 'description',
    address_field = 'originaladdress1',
    date_field    = 'completeddate',
    value_field   = 'housingunits',
    lat_field     = 'latitude',
    lng_field     = 'longitude'
WHERE source_key = 'socrata_seattle';

-- San Francisco CA (permit_number, status, description, street_number+name
-- aren't combined; use street_name as address_field best-effort; location
-- object holds lat/lng under .coordinates, not a flat latitude/longitude —
-- map what's available)
UPDATE permit_sources
SET id_field      = 'permit_number',
    type_field    = 'permit_type_definition',
    status_field  = 'status',
    desc_field    = 'description',
    address_field = 'street_name',
    date_field    = 'issued_date',
    value_field   = 'estimated_cost',
    lat_field     = NULL,
    lng_field     = NULL
WHERE source_key = 'socrata_sf';

-- Baton Rouge LA — the v2 feed does not have latitude/longitude columns
UPDATE permit_sources
SET lat_field = NULL,
    lng_field = NULL
WHERE source_key = 'v2_socrata_baton_rouge';

-- ── B. Disable endpoints that returned 404 / 403 / fetch-failed on live
--     probe (2026-04-16) so the cron stops incrementing error_count on them.
--     Re-enable once a replacement URL is verified. ─────────────────────────

UPDATE permit_sources
SET enabled = false
WHERE source_key IN (
  'arcgis_arlington', 'arcgis_atlanta', 'arcgis_aurora', 'arcgis_durham',
  'arcgis_fairfax', 'arcgis_houston', 'arcgis_knoxville', 'arcgis_sanjose',
  'arcgis_stpete', 'arcgis_tampa',
  'socrata_baltimore', 'socrata_berkeley', 'socrata_buffalo',
  'socrata_cleveland', 'socrata_denver', 'socrata_honolulu',
  'socrata_houston', 'socrata_jersey', 'socrata_la',
  'socrata_louisville', 'socrata_miami_dade', 'socrata_milwaukee',
  'socrata_montgomery', 'socrata_nashville', 'socrata_nola',
  'socrata_nyc', 'socrata_phoenix', 'socrata_santa_monica',
  'socrata_sd', 'socrata_seattle_lu'
);

-- ── C. Add 3 new verified sources (nationwide coverage expansion) ────────────

INSERT INTO permit_sources (
  source_key, name, state, city, jurisdiction,
  endpoint, source_type, auth, update_freq,
  id_field, type_field, status_field, desc_field,
  address_field, date_field, value_field, lat_field, lng_field
)
VALUES

-- NYC DOB Permits Issued (the real NYC building permits feed)
('v3_socrata_nyc_dob', 'NYC DOB Permits Issued', 'NY', 'New York', 'NYC Department of Buildings',
 'https://data.cityofnewyork.us/resource/ipu4-2q9a.json', 'socrata', 'socrata_token', 'daily',
 'job__', 'permit_type', 'permit_status', 'work_type',
 'street_name', 'issuance_date', NULL, 'gis_latitude', 'gis_longitude'),

-- NYC DOB Job Applications (approved jobs — huge volume, current)
('v3_socrata_nyc_jobs', 'NYC DOB Job Applications', 'NY', 'New York', 'NYC Department of Buildings',
 'https://data.cityofnewyork.us/resource/ic3t-wcy2.json', 'socrata', 'socrata_token', 'daily',
 'job__', 'job_type', 'job_status', 'job_description',
 'street_name', 'latest_action_date', 'initial_cost', 'gis_latitude_', 'gis_longitude_'),

-- Dallas TX Building Permits
('v3_socrata_dallas', 'Dallas Building Permits', 'TX', 'Dallas', 'City of Dallas',
 'https://www.dallasopendata.com/resource/e7gq-4sah.json', 'socrata', 'socrata_token', 'daily',
 'permit_number', 'permit_type', 'permit_type', 'work_description',
 'street_address', 'issued_date', 'value', NULL, NULL)

ON CONFLICT (source_key) DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback:
--   DELETE FROM permit_sources WHERE source_key LIKE 'v3_%';
--   UPDATE permit_sources SET enabled = true WHERE source_key IN (... list above);
--   (field-mapping UPDATEs in section A are not auto-reversible; if needed,
--    run 00014 again manually to restore original broken mappings.)
-- ─────────────────────────────────────────────────────────────────────────────
