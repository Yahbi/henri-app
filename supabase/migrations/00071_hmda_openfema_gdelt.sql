-- 00071_hmda_openfema_gdelt.sql
-- Wave 2.B Phase 1 of the data-acquisition plan
-- (~/.claude/plans/whats-the-14-days-purring-papert.md). Adds 3 more
-- canonical-data-layer tables that close the next batch of Henri data
-- gaps:
--
--   mortgages_hmda          — HMDA Modified LAR home-improvement
--                             originations (CFPB), rotated by US state
--   claims_disasters_fema   — FEMA disaster declarations (OpenFEMA v2)
--   triggers_news_gdelt     — GDELT 2.0 news triggers (broke ground,
--                             ribbon cutting, new construction, etc.)
--
-- Service-role-write only. Reads happen via Henri's existing
-- /api/enrich/* and /api/cron/score routes (also service role). RLS
-- enabled with no policies (matches accepted-risk pattern).
--
-- Idempotent + additive. Re-runs are safe.

BEGIN;

-- ── HMDA Modified LAR (home-improvement originations) ────────────────
-- Source: ffiec.cfpb.gov/v2/data-browser-api/view/csv. Filtered to
-- action_taken=1 (originated) + loan_purposes=5 (home improvement).
--
-- Composite PK on (lei, activity_year, county_code, census_tract,
-- loan_amount, action_taken) is best-effort uniqueness — HMDA Modified
-- LAR drops the loan-level unique identifier so we de-dup on the
-- combination of fields that should pin a single origination. Re-runs
-- of the same state-year are idempotent via this PK.
CREATE TABLE IF NOT EXISTS public.mortgages_hmda (
  hmda_uid                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_year            smallint NOT NULL,
  state_code               text,                                  -- 2-letter abbrev
  county_code              text,                                  -- 5-digit FIPS
  census_tract             text,                                  -- 11-digit GEOID
  derived_msa_md           text,
  lei                      text,                                  -- lender LEI
  action_taken             smallint,                              -- 1 = originated
  loan_purpose             smallint,                              -- 5 = home improvement
  loan_type                smallint,
  loan_amount              numeric,
  property_value           numeric,
  occupancy_type           smallint,
  total_units              text,
  derived_loan_product_type text,
  derived_dwelling_category text,
  derived_ethnicity        text,
  derived_race             text,
  derived_sex              text,
  interest_rate            numeric,
  income                   numeric,
  raw_json                 jsonb,
  ingested_at              timestamptz NOT NULL DEFAULT now()
);

-- De-dup composite — re-fetching the same state-year shouldn't pile up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hmda_loan
  ON public.mortgages_hmda (
    activity_year, state_code, county_code, census_tract,
    lei, loan_amount, action_taken
  );

CREATE INDEX IF NOT EXISTS idx_hmda_state_year
  ON public.mortgages_hmda (state_code, activity_year DESC);
CREATE INDEX IF NOT EXISTS idx_hmda_county
  ON public.mortgages_hmda (county_code);
CREATE INDEX IF NOT EXISTS idx_hmda_purpose
  ON public.mortgages_hmda (loan_purpose);

ALTER TABLE public.mortgages_hmda ENABLE ROW LEVEL SECURITY;

-- ── FEMA disaster declarations (OpenFEMA v2) ─────────────────────────
-- Source: fema.gov/api/open/v2/DisasterDeclarationsSummaries.
-- One row per (disaster_number, fips_county_code, place_code) — the
-- v2 API guarantees `id` is unique per record so we use it as PK.
CREATE TABLE IF NOT EXISTS public.claims_disasters_fema (
  fema_id                text PRIMARY KEY,                        -- OpenFEMA `id`
  disaster_number        integer,
  declaration_type       text,                                    -- "DR" / "EM" / "FM"
  declaration_date       timestamptz,
  incident_type          text,                                    -- "Hurricane" / "Tornado" / etc.
  declaration_title      text,
  state                  text,                                    -- 2-letter
  fips_county_code       text,
  place_code             text,
  designated_area        text,
  incident_begin_date    timestamptz,
  incident_end_date      timestamptz,
  raw_json               jsonb,
  ingested_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fema_disasters_state
  ON public.claims_disasters_fema (state);
CREATE INDEX IF NOT EXISTS idx_fema_disasters_recent
  ON public.claims_disasters_fema (declaration_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_fema_disasters_county
  ON public.claims_disasters_fema (fips_county_code)
  WHERE fips_county_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fema_disasters_incident
  ON public.claims_disasters_fema (incident_type);

ALTER TABLE public.claims_disasters_fema ENABLE ROW LEVEL SECURITY;

-- ── GDELT 2.0 news triggers ──────────────────────────────────────────
-- Source: api.gdeltproject.org/api/v2/doc/doc.
-- Captures construction-trigger events ("broke ground", "ribbon
-- cutting", "groundbreaking ceremony", etc.). URL is the natural PK —
-- GDELT canonicalizes article URLs so the same article isn't returned
-- twice. We trim the URL to 1024 chars to keep the index size sane.
CREATE TABLE IF NOT EXISTS public.triggers_news_gdelt (
  trigger_uid     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url             text NOT NULL,
  title           text,
  seen_date       timestamptz,
  domain          text,
  language        text,
  source_country  text,
  query_match     text,                                            -- which query matched
  raw_json        jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gdelt_url
  ON public.triggers_news_gdelt (url);
CREATE INDEX IF NOT EXISTS idx_gdelt_recent
  ON public.triggers_news_gdelt (seen_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_gdelt_query
  ON public.triggers_news_gdelt (query_match);
CREATE INDEX IF NOT EXISTS idx_gdelt_title_trgm
  ON public.triggers_news_gdelt USING gin (title gin_trgm_ops);

ALTER TABLE public.triggers_news_gdelt ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── Apply path ──────────────────────────────────────────────────────
--   pnpm migrate
--   OR Supabase SQL editor.
--
-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('mortgages_hmda','claims_disasters_fema',
--                        'triggers_news_gdelt');
-- Should return 3.
