-- ─────────────────────────────────────────────────────────────────────
-- 00085 · `parcels_sidecar` + `parcel_sources` registry — statewide
--          parcel/assessor feeds for the 7 dead-permit states.
--
-- The 2026-05-06 + 2026-05-07 + 2026-05-08 research passes confirmed
-- that 7 states have NO public construction-permit APIs (ME, MS, NH,
-- OK, RI, UT, WV). The substitute-layer strategy uses statewide parcel
-- + assessor data to feed the same lead-gen pipeline:
--   • Owner name + mailing address → enables owner-occupancy + outreach
--   • Recent transfer flag (NewOwner / LAST_SALE_DT) → strongest
--     leading indicator of upcoming construction work
--   • Building characteristics (BUILT_YR, BLDG_SQFT, etc.) → enables
--     trade-segmentation (e.g. "1950s ranch homes in zip X" → likely
--     HVAC retrofit market)
--
-- This sidecar is DISTINCT from Henri's existing `parcels` table which
-- is sourced from Regrid (commercial, ~$$, contains 99% of US parcels).
-- The sidecar covers states where Regrid coverage is thin AND where we
-- need fresher data than Regrid's quarterly refresh — primarily UT
-- (UGRC SGID quarterly), WV (WVGIS quarterly), OK (Canadian Co fresh
-- daily), ME (refreshable via Maine GeoLib).
--
-- Service-role-write only. RLS enabled with no policies (matches
-- accepted-risk pattern from voter_*, ppp_loans, claims_*, weather_*,
-- liens_county_recorder).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. parcel_sources registry table ───────────────────────────────
-- Mirrors contractor_license_sources (00073) shape. Each row describes
-- one statewide-or-county parcel feed. The cron rotator picks the
-- most-overdue enabled source per run.

CREATE TABLE IF NOT EXISTS public.parcel_sources (
  source_key       text PRIMARY KEY,
  state_code       text NOT NULL,                -- 2-letter
  jurisdiction     text NOT NULL,                -- 'STATEWIDE' or county/city
  jurisdiction_type text NOT NULL DEFAULT 'state_aggregator',
  -- One of: 'arcgis' | 'socrata' | 'csv' | 'scrape'
  source_kind      text NOT NULL,
  endpoint_url     text NOT NULL,
  -- Logical type of data the endpoint serves. The orchestrator routes
  -- 'parcel' (geometry-only) and 'assessor' (owner+value) differently:
  -- assessor rows enrich leads; parcel-only rows are for coverage maps.
  data_layer       text NOT NULL CHECK (data_layer IN ('parcel','assessor')),
  -- Maps upstream column names → canonical Henri fields.
  field_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT false,
  -- Bookkeeping
  last_run_at      timestamptz,
  last_count       integer,
  error_count      integer NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parcel_sources_state_idx
  ON public.parcel_sources (state_code);
CREATE INDEX IF NOT EXISTS parcel_sources_enabled_lastrun_idx
  ON public.parcel_sources (enabled, last_run_at NULLS FIRST);

ALTER TABLE public.parcel_sources ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (matches contractor_license_sources).

COMMENT ON TABLE public.parcel_sources IS
  'Registry of statewide/county parcel + assessor feeds. Service-role-write only. '
  'Rotator cron picks the most-overdue enabled source per run.';


-- ── 2. parcels_sidecar data table ──────────────────────────────────
-- Receives normalized rows from the loader. Distinct from the Regrid-
-- sourced `parcels` table because:
--   1. We don't want to overwrite Regrid's authoritative data with
--      lower-quality state-level data.
--   2. We DO want to capture state-specific signals (NewOwner flag in
--      WV, last_sale_dt in UT) that Regrid sometimes misses.
--   3. The orchestrator can fall through to this sidecar when Regrid
--      returns null for a parcel.

CREATE TABLE IF NOT EXISTS public.parcels_sidecar (
  -- Synthetic UID; (state_code, source_parcel_id) is the dedup key.
  sidecar_uid       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key        text NOT NULL REFERENCES public.parcel_sources(source_key)
                                    ON DELETE CASCADE,
  state_code        text NOT NULL,
  -- Upstream parcel identifier — varies per state (PARCEL_ID, APN,
  -- TaxParcelID, etc.). Combined with state_code for global uniqueness.
  source_parcel_id  text NOT NULL,
  -- Canonical normalized fields. Loader maps upstream columns to these
  -- via field_map JSON in parcel_sources.
  owner_name        text,
  owner_mailing_addr text,
  situs_addr        text,
  situs_city        text,
  situs_zip         text,
  -- Strongest construction-leading-indicator (WV ParcelSummary has it).
  -- When upstream emits a 'NewOwner' or 'LastSaleDate < 90d' flag, we
  -- record it so the scorer can boost recently-transferred parcels.
  recent_transfer_at date,
  -- Assessor data (sparse for parcel-only feeds, populated for assessor).
  total_appraisal   bigint,
  building_appraisal bigint,
  land_appraisal    bigint,
  built_year        integer,
  building_sqft     integer,
  land_use          text,
  occupancy_desc    text,
  -- Resident phone (rare; WV Site Addresses has Res_Phone, Butler Co KS
  -- has multiple contractor phones — those go here).
  resident_phone    text,
  -- Raw upstream record so a re-normalize pass can re-derive if
  -- field_map changes.
  raw_json          jsonb NOT NULL,
  -- Bookkeeping
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  upstream_updated_at timestamptz,
  CONSTRAINT uq_parcels_sidecar_dedup UNIQUE (state_code, source_parcel_id)
);

CREATE INDEX IF NOT EXISTS parcels_sidecar_state_zip_idx
  ON public.parcels_sidecar (state_code, situs_zip)
  WHERE situs_zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS parcels_sidecar_recent_transfer_idx
  ON public.parcels_sidecar (state_code, recent_transfer_at DESC NULLS LAST)
  WHERE recent_transfer_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS parcels_sidecar_owner_lower_idx
  ON public.parcels_sidecar (state_code, lower(owner_name))
  WHERE owner_name IS NOT NULL;

ALTER TABLE public.parcels_sidecar ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.

COMMENT ON TABLE public.parcels_sidecar IS
  'State-level parcel + assessor data for the 7 dead-permit states '
  '(ME/MS/NH/OK/RI/UT/WV). Distinct from Regrid-sourced public.parcels. '
  'Service-role-write only. Read path: orchestrator falls through to here '
  'when Regrid returns null for a parcel in these states.';


-- ── 3. Seed: 7 verified high-leverage substitute endpoints ─────────
-- All marked enabled=false until first Hetzner smoke-test confirms the
-- field_map mapping is correct. Operator flips enabled=true after
-- successful load_parcels_arcgis.py <slug> dry-run.

INSERT INTO public.parcel_sources
  (source_key, state_code, jurisdiction, jurisdiction_type, source_kind,
   endpoint_url, data_layer, field_map, enabled, notes)
VALUES
  -- ─── UT — Utah Statewide Parcels (UGRC SGID) ────────────────────
  ('UT-STATEWIDE-PARCELS', 'UT', 'STATEWIDE', 'state_aggregator', 'arcgis',
   'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0/query',
   'parcel',
   '{"source_parcel_id":"PARCEL_ID","situs_addr":"PARCEL_ADD","situs_city":"PARCEL_CITY","situs_zip":"PARCEL_ZIP"}'::jsonb,
   false,
   'UGRC SGID quarterly refresh. 1.58M parcels statewide. Geometry+metadata only — no owner names. Pair with UT-LIR for owner+value.'),

  -- ─── UT — Utah LIR Parcels (assessor companion) ─────────────────
  ('UT-LIR-PARCELS', 'UT', 'STATEWIDE', 'state_aggregator', 'arcgis',
   'https://opendata.gis.utah.gov/datasets/utah::utah-lir-parcels/about',
   'assessor',
   '{"source_parcel_id":"PARCEL_ID","owner_name":"OWN_NAME","owner_mailing_addr":"OWN_ADDR","situs_city":"OWN_CITY","situs_zip":"OWN_ZIP","total_appraisal":"TOTAL_MKT_VALUE","building_appraisal":"BLDG_MKT_VALUE","land_appraisal":"LAND_MKT_VALUE","built_year":"BUILT_YR","building_sqft":"BLDG_SQFT","land_use":"USE_DESC"}'::jsonb,
   false,
   'PRIMARY UT SUBSTITUTE. Quarterly refresh from county assessors. The trifecta: owner + last_sale + building characteristics. NOTE endpoint_url currently points at the dataset landing page — first run should resolve to the actual FeatureServer URL via opendata.gis.utah.gov DCAT.'),

  -- ─── WV — ParcelSummary table (1.5M, gold-tier) ─────────────────
  ('WV-PARCEL-SUMMARY', 'WV', 'STATEWIDE', 'state_aggregator', 'arcgis',
   'https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/11/query',
   'assessor',
   '{"source_parcel_id":"CleanParcelID","owner_name":"FullOwnerName","owner_mailing_addr":"FullOwnerAddress","situs_addr":"PhysicalStreet","situs_city":"PhysicalCity","total_appraisal":"TotalAppraisal","building_appraisal":"BuildingAppraisal","land_appraisal":"LandAppraisal","built_year":"YearBuilt","building_sqft":"BusinessLivingArea","land_use":"LandUse","occupancy_desc":"OccupancyDescription"}'::jsonb,
   false,
   'PRIMARY WV SUBSTITUTE. WVGIS Tech Center @ WVU. 1.5M records statewide. Includes NewOwner field — strongest construction-leading-indicator. Quarterly refresh from county assessors.'),

  -- ─── WV — Site Address Points (911 dataset, has Res_Phone) ──────
  ('WV-SITE-ADDRESSES', 'WV', 'STATEWIDE', 'state_aggregator', 'arcgis',
   'https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/5/query',
   'parcel',
   '{"source_parcel_id":"ESN","situs_addr":"FULLADDR","situs_city":"MUNICIPALITY","situs_zip":"Zip","resident_phone":"Res_Phone"}'::jsonb,
   false,
   'RARE FIND. 1.05M records. WVDHSEM 911 dataset includes Res_Name + Res_Phone — direct phone-fill source for WV residents. Henri 1% phone ceiling drops to near-100% for WV leads.'),

  -- ─── OK — Canadian County (OKC western metro) ────────────────────
  ('OK-CANADIAN-COUNTY', 'OK', 'CANADIAN-COUNTY', 'county', 'arcgis',
   'https://services2.arcgis.com/0NjdXxmJp53hZWPd/arcgis/rest/services/ParcelDataService_2_view/FeatureServer/3/query',
   'assessor',
   '{"source_parcel_id":"parcel_id","owner_name":"owners_name","situs_addr":"physical_address","situs_city":"city"}'::jsonb,
   false,
   '84,772 records, fresh 2026-04-30. Covers OKC western suburbs (Yukon, Mustang, El Reno) — fast-growing residential market. displayField=owners_name. Companion sublayers: 0=Subdivisions, 2=Lots, 4=Blocks. Note: field names are best-guess from displayField; first run may need field_map tuning.'),

  -- ─── ME — Maine Parcels Organized Towns (refreshable) ────────────
  ('ME-PARCELS-ORGANIZED-TOWNS', 'ME', 'STATEWIDE', 'state_aggregator', 'arcgis',
   'https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/0/query',
   'parcel',
   '{"source_parcel_id":"Parcel_ID"}'::jsonb,
   false,
   'Maine GeoLibrary. Non-static, refreshable. 716K parcels. Geometry-only — pair with the ADB related table (joined on Parcel_ID) for OWNER1, OWNER2, MAILADDR, SALEDATE, ASSESSED. Field-map will need extension after first run resolves the join.'),

  -- ─── MS — Harrison County (Gulfport) ────────────────────────────
  ('MS-HARRISON-COUNTY', 'MS', 'HARRISON-COUNTY', 'county', 'arcgis',
   'https://geo.co.harrison.ms.us/server/rest/services/AGO/HarrisonCounty_ApprovedParcels/FeatureServer/0/query',
   'parcel',
   '{}'::jsonb,
   false,
   'BORDERLINE FRESHNESS — modified 2024-12. MS has no statewide parcel aggregator. Best Gulf Coast substitute (Gulfport area). 108k parcels. field_map empty — first run must probe schema and populate.')
ON CONFLICT (source_key) DO UPDATE
  SET endpoint_url = EXCLUDED.endpoint_url,
      field_map    = EXCLUDED.field_map,
      notes        = EXCLUDED.notes,
      updated_at   = now();


-- ── 4. moddatetime trigger to keep updated_at fresh ─────────────────
DO $$ BEGIN
  CREATE TRIGGER parcel_sources_moddatetime
    BEFORE UPDATE ON public.parcel_sources
    FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


COMMIT;
