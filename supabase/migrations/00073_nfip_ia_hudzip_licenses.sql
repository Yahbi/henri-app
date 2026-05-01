-- 00073_nfip_ia_hudzip_licenses.sql
-- Wave 2.B Phase 2 of the data-acquisition plan
-- (~/.claude/plans/whats-the-14-days-purring-papert.md). Adds 5 more
-- canonical-data-layer tables that close out the federal-claims and
-- contractor-license slices:
--
--   claims_nfip                 — OpenFEMA NFIP redacted claims (since 1978)
--   claims_ia                   — OpenFEMA Individual Assistance valid registrations
--   zip_crosswalk_hud           — HUD USPS ZIP↔Tract/Place/CBSA/County (XLSX-sourced)
--   state_license_rosters       — 50-state contractor license rosters (public per-state-board search; distinct from `contractor_licenses` which is per-contractor-account verification)
--   contractor_license_sources  — registry of per-state endpoints (Socrata / ArcGIS / scrape)
--
-- Service-role-write only. Reads via Henri's existing /api/enrich/*
-- and /api/cron/score routes (also service role). RLS enabled with
-- no policies (matches accepted-risk pattern).
--
-- Idempotent + additive. Re-runs are safe.

BEGIN;

-- ── OpenFEMA NFIP redacted claims ─────────────────────────────────────
-- Source: fema.gov/api/open/v2/FimaNfipClaims. Pulled by the
-- /api/cron/openfema-nfip route which rotates one year-of-loss per
-- daily run (1978–current = ~48 years to fully back-fill). `id` is
-- the OpenFEMA per-record GUID and is the natural PK.
CREATE TABLE IF NOT EXISTS public.claims_nfip (
  fema_id                          text PRIMARY KEY,
  date_of_loss                     date,
  year_of_loss                     smallint,
  reported_zip_code                text,
  county                           text,
  state                            text,
  occupancy_type                   text,
  floors                           text,
  flood_zone                       text,
  year_of_construction             smallint,
  total_building_insurance_coverage numeric,
  amount_paid_on_building_claim    numeric,
  amount_paid_on_contents_claim    numeric,
  cause_of_damage                  text,
  raw_json                         jsonb,
  ingested_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nfip_zip
  ON public.claims_nfip (reported_zip_code)
  WHERE reported_zip_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfip_state
  ON public.claims_nfip (state);
CREATE INDEX IF NOT EXISTS idx_nfip_year
  ON public.claims_nfip (year_of_loss DESC);
CREATE INDEX IF NOT EXISTS idx_nfip_date
  ON public.claims_nfip (date_of_loss DESC);

ALTER TABLE public.claims_nfip ENABLE ROW LEVEL SECURITY;

-- ── OpenFEMA Individual Assistance valid registrations ───────────────
-- Source: fema.gov/api/open/v2/IndividualsAndHouseholdsProgramValidRegistrations.
-- Pulled by /api/cron/openfema-ia rotating by disaster_number. Same
-- shape as claims_nfip — `id` is the OpenFEMA PK.
CREATE TABLE IF NOT EXISTS public.claims_ia (
  fema_id                  text PRIMARY KEY,
  disaster_number          integer,
  damaged_zip_code         text,
  county                   text,
  state                    text,
  own_rent                 text,
  residence_type           text,
  flood_damage_amount      numeric,
  foundation_damage_amount numeric,
  roof_damage_amount       numeric,
  raw_json                 jsonb,
  ingested_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_zip
  ON public.claims_ia (damaged_zip_code)
  WHERE damaged_zip_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ia_state
  ON public.claims_ia (state);
CREATE INDEX IF NOT EXISTS idx_ia_disaster
  ON public.claims_ia (disaster_number);

ALTER TABLE public.claims_ia ENABLE ROW LEVEL SECURITY;

-- ── HUD USPS ZIP crosswalk (Tract / Place / CBSA / County) ───────────
-- Source: huduser.gov/portal/datasets/usps_crosswalk.html (XLSX).
-- Long-format storage (one row per (zip, geo_kind, geoid, quarter))
-- so the four files coexist in one table.
CREATE TABLE IF NOT EXISTS public.zip_crosswalk_hud (
  zip            text NOT NULL,
  geoid          text NOT NULL,
  geo_kind       text NOT NULL                                   -- 'tract' / 'place' / 'cbsa' / 'county'
                 CHECK (geo_kind IN ('tract', 'place', 'cbsa', 'county')),
  quarter        text NOT NULL,                                  -- e.g. '2024Q4'
  res_ratio      numeric,                                        -- residential ratio of mappings
  bus_ratio      numeric,
  oth_ratio      numeric,
  tot_ratio      numeric,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zip, geo_kind, geoid, quarter)
);

CREATE INDEX IF NOT EXISTS idx_zipxw_zip
  ON public.zip_crosswalk_hud (zip);
CREATE INDEX IF NOT EXISTS idx_zipxw_geoid
  ON public.zip_crosswalk_hud (geoid);
CREATE INDEX IF NOT EXISTS idx_zipxw_kind
  ON public.zip_crosswalk_hud (geo_kind);

ALTER TABLE public.zip_crosswalk_hud ENABLE ROW LEVEL SECURITY;

-- ── Contractor license sources (registry of per-state endpoints) ─────
-- Drives the /api/cron/contractor-licenses-rotate cron. Each row
-- describes one state's licensing-board feed: the endpoint URL,
-- protocol kind (Socrata / ArcGIS / scrape), the columns we map to
-- our canonical schema, and an enabled flag so rotators skip dead
-- endpoints without a code change.
CREATE TABLE IF NOT EXISTS public.contractor_license_sources (
  state_code        text PRIMARY KEY,                            -- 2-letter
  state_name        text NOT NULL,
  source_kind       text NOT NULL                                -- 'socrata' / 'arcgis' / 'scrape'
                    CHECK (source_kind IN ('socrata', 'arcgis', 'scrape')),
  endpoint_url      text NOT NULL,
  /* Column-name mapping from upstream → our canonical schema.
   * Stored as jsonb (e.g. {"license_number": "license_no",
   * "license_status": "status", "name": "business_name"}). */
  field_map         jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled           boolean NOT NULL DEFAULT true,
  notes             text,
  /* Last successful run for this source — bumped by the cron after
   * a non-zero insert. Used by the rotator to fairly cycle. */
  last_run_at       timestamptz,
  last_inserted     integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contractor_license_sources ENABLE ROW LEVEL SECURITY;

-- ── Contractor license rosters (canonical) ───────────────────────────
-- One row per (state_code, license_number). Re-runs of the same
-- state idempotent via the composite PK.
CREATE TABLE IF NOT EXISTS public.state_license_rosters (
  state_code        text NOT NULL,
  license_number    text NOT NULL,
  business_name     text,
  license_type      text,                                         -- e.g. 'C-39' (CSLB roofing)
  license_status    text,                                         -- 'ACTIVE' / 'EXPIRED' / etc.
  issue_date        date,
  expire_date       date,
  city              text,
  state             text,
  zip               text,
  phone             text,
  email             text,
  raw_json          jsonb,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_code, license_number)
);

CREATE INDEX IF NOT EXISTS idx_licenses_state
  ON public.state_license_rosters (state_code);
CREATE INDEX IF NOT EXISTS idx_licenses_status
  ON public.state_license_rosters (license_status);
CREATE INDEX IF NOT EXISTS idx_licenses_expire
  ON public.state_license_rosters (expire_date)
  WHERE expire_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_zip
  ON public.state_license_rosters (zip)
  WHERE zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_business_trgm
  ON public.state_license_rosters USING gin (business_name gin_trgm_ops);

ALTER TABLE public.state_license_rosters ENABLE ROW LEVEL SECURITY;

-- ── Seed verified-live state license endpoints ───────────────────────
-- Initial seed covers the 7 states with confirmed-working JSON feeds
-- per the data-complete catalog v3. The remaining 43 states either
-- have placeholder URLs that need per-state research or require
-- scraping (Track B platform adapters). Seeding is idempotent via
-- the PK.
INSERT INTO public.contractor_license_sources
  (state_code, state_name, source_kind, endpoint_url, field_map, enabled, notes)
VALUES
  ('CA', 'California',  'socrata',
   'https://data.ca.gov/api/3/action/datastore_search?resource_id=ed01a1d5-b3a9-4dec-9a30-fa53e10aa8f7',
   '{"license_number": "LicenseNo", "business_name": "BusinessName", "license_status": "PrimaryStatus", "license_type": "ClassificationCode", "issue_date": "IssueDate", "expire_date": "ExpireDate", "city": "MailingCity", "state": "MailingState", "zip": "MailingZip", "phone": "BusinessPhone"}',
   true,
   'CSLB — California State License Board. The dataset is published via CKAN datastore_search; rotator fetches via offset paging.'),
  ('FL', 'Florida',     'socrata', 'https://data.fldfs.com/resource/i9ey-fdtn.json',
   '{}', true,
   'FL DBPR licensee feed (Socrata).'),
  ('NY', 'New York',    'socrata', 'https://data.ny.gov/resource/xkeg-bpg6.json',
   '{}', true,
   'NY Home Improvement Contractors Licensed (Socrata).'),
  ('WA', 'Washington',  'socrata', 'https://data.lni.wa.gov/resource/bdgi-7xij.json',
   '{}', true,
   'WA L&I registered contractors (Socrata).'),
  ('OR', 'Oregon',      'socrata', 'https://data.oregon.gov/resource/p8qe-4r2t.json',
   '{}', true,
   'OR CCB licensees (Socrata) — placeholder, needs per-resource verification.'),
  ('AZ', 'Arizona',     'socrata', 'https://azcontractors.azroc.gov/api/contractor.json',
   '{}', false,
   'AZ ROC — endpoint unverified; disabled until validated.'),
  ('IL', 'Illinois',    'socrata', 'https://data.illinois.gov/resource/idfpr-licenses.json',
   '{}', false,
   'IL DFPR — placeholder, disabled until validated.')
ON CONFLICT (state_code) DO NOTHING;

COMMIT;

-- ── Apply path ──────────────────────────────────────────────────────
--   pnpm migrate
--   OR Supabase SQL editor.
--
-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('claims_nfip','claims_ia','zip_crosswalk_hud',
--                        'state_license_rosters','contractor_license_sources');
-- Should return 5.
--
--   SELECT state_code, source_kind, enabled FROM contractor_license_sources ORDER BY state_code;
-- Should return 7 seeded rows.
