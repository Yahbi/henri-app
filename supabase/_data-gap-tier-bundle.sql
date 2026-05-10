-- ─────────────────────────────────────────────────────────────────────
-- DATA-GAP TIER-RESEARCH BUNDLE — paste-once into the Supabase SQL editor.
-- Source files: supabase/migrations/00082_*.sql / 00083_*.sql / 00084_*.sql
-- Generated: 2026-05-07
--
-- All three migrations are additive + idempotent. Pasting this whole
-- bundle into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new
-- and clicking Run is safe to re-run.
--
-- Order matters: 00082 first (creates the helper functions), then
-- 00083 (license-roster INSERTs), then 00084 (creates liens_county_recorder).
-- All three wrap their changes in BEGIN; ... COMMIT; — if any one fails,
-- only that migration rolls back.
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- 00082 · Owner-occupied detector via mailing-address vs situs-address
--        mismatch (Tier 4 free win — research/SUMMARY-2026-05-07.md).
--
-- The 22 county-GIS adapters in src/lib/enrichment/county-gis.ts already
-- capture both `owner_occupied` (sometimes-null) and `mailing_address`.
-- When mailing_address ≠ situs_address, the property is almost certainly
-- investor-owned. This migration ships:
--
--   1. `public.parcels_owner_occupancy` view — derives a 3-state
--      occupancy signal (true / false / unknown) from the existing
--      `parcels.mailing_address` and `parcels.situs_address` columns.
--      No new ingestion required.
--
--   2. `public.compute_owner_occupied(...)` deterministic helper that
--      the score signal calls. Returns:
--        · true   — same address (owner-occupied)
--        · false  — mismatched address (rental / investor)
--        · null   — one or both fields missing (unknown)
--
-- Idempotent + additive. No breaking change to existing rows.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- Helper: normalize an address for comparison. Strips punctuation,
-- collapses whitespace, uppercases, and strips trailing city/state/zip.
-- Mirrors src/lib/enrichment/county-gis.ts stripAddressTrailer + same
-- comma-trim logic used everywhere else in Henri.
CREATE OR REPLACE FUNCTION public.normalize_address_for_match(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN addr IS NULL OR length(trim(addr)) = 0 THEN NULL
    ELSE upper(
      regexp_replace(
        regexp_replace(
          -- drop trailing ", CITY STATE ZIP" — same logic as TS helper
          split_part(addr, ',', 1),
          '\s+', ' ', 'g'
        ),
        '[^A-Z0-9 ]', '', 'g'
      )
    )
  END
$$;

COMMENT ON FUNCTION public.normalize_address_for_match(text) IS
  '00082 - Mirrors stripAddressTrailer in TS county-gis.ts. Used by '
  'compute_owner_occupied so the SQL signal matches the JS-side enrichment.';

-- Compute the 3-state occupancy signal.
CREATE OR REPLACE FUNCTION public.compute_owner_occupied(
  situs   text,
  mailing text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- One side missing — can't tell, leave caller's default in place.
    WHEN situs   IS NULL OR length(trim(situs))   = 0 THEN NULL
    WHEN mailing IS NULL OR length(trim(mailing)) = 0 THEN NULL
    -- Both sides present — compare normalized forms.
    WHEN public.normalize_address_for_match(situs)
       = public.normalize_address_for_match(mailing)
      THEN true
    ELSE false
  END
$$;

COMMENT ON FUNCTION public.compute_owner_occupied(text, text) IS
  '00082 - Returns true when situs and mailing addresses normalize equal '
  '(owner-occupied), false when they differ (rental/investor), null when '
  'either side is missing (unknown). Lifts owner_occupied confidence from '
  '0.5 default to ~0.85 wherever both addresses are populated.';

-- View: per-parcel occupancy signal. Joins the canonical `parcels` table
-- to derived occupancy. The view is fast — function is IMMUTABLE +
-- PARALLEL SAFE so the planner can inline it.
--
-- Wrapped in a DO block because the parcels table may not exist in dev
-- environments that haven't applied earlier migrations. The view is
-- always correct in environments that have parcels; absent there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND c.relname = 'parcels' AND n.nspname = 'public'
  ) THEN
    EXECUTE $V$
      CREATE OR REPLACE VIEW public.parcels_owner_occupancy AS
      SELECT
        p.parcel_id,
        p.situs_address,
        p.mailing_address,
        public.compute_owner_occupied(p.situs_address, p.mailing_address)
          AS owner_occupied_derived,
        CASE
          WHEN public.compute_owner_occupied(p.situs_address, p.mailing_address) IS NULL
            THEN 0.5
          WHEN public.compute_owner_occupied(p.situs_address, p.mailing_address) = true
            THEN 0.85
          ELSE 0.85
        END AS occupancy_confidence
      FROM public.parcels p
    $V$;

    COMMENT ON VIEW public.parcels_owner_occupancy IS
      '00082 - Owner-occupancy signal derived from mailing-vs-situs mismatch. '
      'occupancy_confidence is 0.85 when both addresses are present (regardless '
      'of match outcome) and 0.5 otherwise. Score signal reads from this view.';
  END IF;
END $$;

COMMIT;



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



-- ─────────────────────────────────────────────────────────────────────
-- 00084 · `liens_county_recorder` — mechanic's liens at the recording
--         layer (county recorder of deeds), distinct from the court
--         layer already covered by `liens_courtlistener`.
--
-- Per Tier-6 reframe in research/tier4_owner_occupied_AND_tier6_lien_portals.md:
-- 85-95% of mechanic's liens are RECORDED INSTRUMENTS at county recorders,
-- not court filings. Court records (CourtListener) only catch the ~5-15%
-- that escalate to foreclosure. This sidecar covers the recording layer
-- via state-recorder bulk feeds, starting with Georgia (gsccca.org —
-- single best statewide source in the US).
--
-- Service-role-write only. RLS enabled with no policies (matches accepted-
-- risk pattern from voter_*, ppp_loans, claims_*).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.liens_county_recorder (
  -- Synthetic UID; recording_id alone is not unique across states.
  lien_uid          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- State-specific recording identifier. GSCCCA Lien Index uses
  -- "<book>-<page>"; MyFloridaCounty uses CFN; Texas uses Document Number.
  recording_id      text NOT NULL,
  recording_state   text NOT NULL,                   -- 2-letter
  recording_county  text,
  recording_date    date,
  -- The party filing the lien — usually the contractor / subcontractor /
  -- supplier who claims they're owed money.
  claimant_name     text,
  -- The party being sued / the alleged debtor — usually the property
  -- owner or general contractor. This is Henri's lookup key for
  -- cross-referencing against permit applicants / owners.
  debtor_name       text,
  property_address  text,
  property_city     text,
  property_zip      text,
  lien_amount       numeric,
  /* Instrument type — varies per state. Common values:
   *   MECHANIC_LIEN, MATERIALMAN_LIEN, CLAIM_OF_LIEN,
   *   NOTICE_OF_COMMENCEMENT, RELEASE_OF_LIEN.
   * Henri scoring should usually weight only active filings
   * (not releases). */
  instrument_type   text,
  source            text NOT NULL,                   -- 'gsccca' | 'mylands_<county>' | etc.
  source_url        text,
  raw_json          jsonb,
  ingested_at       timestamptz NOT NULL DEFAULT now()
);

-- Composite uniqueness — same recording can't appear twice within the
-- same state, but the "<book>-<page>" form does collide across states.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lien_recorder_state_id
  ON public.liens_county_recorder (recording_state, recording_id);

-- Most-frequent query is "lien filings near this address in last 90d".
CREATE INDEX IF NOT EXISTS idx_lien_recorder_state_date
  ON public.liens_county_recorder (recording_state, recording_date DESC);
CREATE INDEX IF NOT EXISTS idx_lien_recorder_zip_date
  ON public.liens_county_recorder (property_zip, recording_date DESC)
  WHERE property_zip IS NOT NULL;
-- Trigram match for debtor-name fuzzy joins to permits.applicant_name.
CREATE INDEX IF NOT EXISTS idx_lien_recorder_debtor_trgm
  ON public.liens_county_recorder USING gin (debtor_name gin_trgm_ops);

ALTER TABLE public.liens_county_recorder ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.liens_county_recorder IS
  '00084 - Mechanic''s liens at the county-recorder layer. Distinct from '
  'liens_courtlistener (court layer). Sidecar feeds: gsccca.org (GA), '
  'MyFloridaCounty (FL per-county), Recorder.org (TX), etc. Service-role-'
  'write; RLS-on-no-policies.';

COMMIT;
