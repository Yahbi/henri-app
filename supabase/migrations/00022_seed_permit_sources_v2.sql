-- 00022_seed_permit_sources_v2.sql
-- Second batch of verified permit sources.
-- Sourced from us_research_verified_apis.csv + us_verified_permit_apis.csv
-- (verification date 2026-03-17), field mappings confirmed by live probe
-- against each endpoint (see scripts/probe-v2-fields.ts).
--
-- All endpoints are HTTPS and route through the existing
-- socrata / arcgis scrapers (src/lib/scrapers/{socrata,arcgis}.ts).
-- Cary NC + small WA towns + LA submitted-only feeds + stale DCRA years
-- were intentionally excluded — see docs/permit-coverage.md and plan.
--
-- Rollback:
--   DELETE FROM permit_sources WHERE source_key LIKE 'v2_%';

BEGIN;

INSERT INTO permit_sources (
  source_key, name, state, city, jurisdiction,
  endpoint, source_type, auth, update_freq,
  id_field, type_field, status_field, desc_field,
  address_field, date_field, value_field, lat_field, lng_field
)
VALUES

-- ── SOCRATA ──────────────────────────────────────────────────────────────────

('v2_socrata_baton_rouge', 'East Baton Rouge Building Permits', 'LA', 'Baton Rouge', 'East Baton Rouge Parish',
 'https://data.brla.gov/resource/7fq7-8j7r.json', 'socrata', 'socrata_token', 'daily',
 'permitnumber', 'permittype', 'designation', 'projectdescription',
 'address', 'issueddate', 'projectvalue', 'latitude', 'longitude'),

-- ── ARCGIS ───────────────────────────────────────────────────────────────────

('v2_arcgis_dc_current', 'Washington DC Building Permits (Current Year)', 'DC', 'Washington', 'District of Columbia DCRA',
 'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/17', 'arcgis', 'none', 'weekly',
 'PERMIT_ID', 'PERMIT_TYPE_NAME', 'APPLICATION_STATUS_NAME', 'DESC_OF_WORK',
 'FULL_ADDRESS', 'ISSUE_DATE', 'FEES_PAID', NULL, NULL),

('v2_arcgis_dc_next', 'Washington DC Building Permits (Next Year)', 'DC', 'Washington', 'District of Columbia DCRA',
 'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18', 'arcgis', 'none', 'weekly',
 'PERMIT_ID', 'PERMIT_TYPE_NAME', 'APPLICATION_STATUS_NAME', 'DESC_OF_WORK',
 'FULL_ADDRESS', 'ISSUE_DATE', 'FEES_PAID', NULL, NULL),

('v2_arcgis_wake_county', 'Wake County NC Building Permits', 'NC', 'Raleigh', 'Wake County NC',
 'https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0', 'arcgis', 'none', 'weekly',
 'PERMIT_NUMBER', 'PERMIT_TYPE', 'PERMIT_STATUS', 'DESCRIPTION',
 'MAILING_ADDRESS', 'ISSUE_DATE', 'VALUATION', NULL, NULL),

('v2_arcgis_hartford', 'Hartford CT Building Permits', 'CT', 'Hartford', 'City of Hartford',
 'https://utility.arcgis.com/usrsvcs/servers/d595ae995fb049d3ac54919ebf24b1ac/rest/services/HartfordOpenDataTables/FeatureServer/0', 'arcgis', 'none', 'weekly',
 'RECORD_ID', 'RECORD_TYPE_TYPE', 'RECORD_STATUS', 'DESCRIPTION',
 'PROPERTY_ADDRESS', 'DateIssued', 'Total_Construction_Cost', NULL, NULL),

('v2_arcgis_tempe', 'Tempe AZ Building Permits', 'AZ', 'Tempe', 'City of Tempe',
 'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0', 'arcgis', 'none', 'weekly',
 'PermitNum', 'PermitType', 'StatusCurrent', 'Description',
 'OriginalAddress1', 'IssuedDate', 'EstProjectCost', NULL, NULL),

('v2_arcgis_sioux_falls', 'Sioux Falls SD Building Permits', 'SD', 'Sioux Falls', 'City of Sioux Falls',
 'https://gis.siouxfalls.gov/arcgis/rest/services/Data/Community/MapServer/3', 'arcgis', 'none', 'weekly',
 'PERMITNUMBER', 'PERMITTYPE', 'PERMITSTATUS', 'WORKCLASS',
 'MAINADDRESS', 'ISSUEDATE', 'VALUATION', NULL, NULL),

('v2_arcgis_louisville_active', 'Louisville Metro Active Construction Permits', 'KY', 'Louisville', 'Louisville Metro Government',
 'https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0', 'arcgis', 'none', 'weekly',
 'PERMIT_NUMBER', 'PERMIT_TYPE', 'PERMIT_STATUS', 'WORK_TYPE',
 'ADDRESS', 'ISSUE_DATE', 'PROJECT_COSTS', NULL, NULL)

ON CONFLICT (source_key) DO NOTHING;

COMMIT;
