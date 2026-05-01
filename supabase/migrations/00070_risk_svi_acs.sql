-- 00070_risk_svi_acs.sql
-- Wave 2.A of the data-acquisition plan
-- (~/.claude/plans/whats-the-14-days-purring-papert.md). Adds 4
-- canonical-data-layer tables that lead scoring + risk overlays can
-- join against:
--
--   risk_nri_county     — FEMA National Risk Index, county-level
--   risk_nri_tract      — FEMA National Risk Index, census-tract-level
--   svi_tracts          — CDC Social Vulnerability Index, tract-level
--   demo_acs_zcta       — Census ACS 5-year, key housing/demo vars by ZCTA
--
-- Service-role-write only. Reads happen via the existing
-- /api/enrich/* and /api/cron/score routes (also service role).
-- RLS enabled with no policies (matches accepted-risk pattern in
-- CLAUDE.md: voter_*, ppp_loans, newsletter_subscribers).
--
-- HUD ZIP crosswalk is intentionally NOT in this migration — its source
-- format is XLSX which needs an extra parser dep before it can ride
-- the Vercel cron path. Tracked for Wave 2.B.
--
-- Idempotent + additive. Re-runs are safe.

BEGIN;

-- ── FEMA NRI: counties ────────────────────────────────────────────────
-- Source: services.arcgis.com (RAPT-hosted FeatureServer).
-- ~3,143 rows. STCOFIPS is the natural PK from the FeatureServer.
CREATE TABLE IF NOT EXISTS public.risk_nri_county (
  county_fips    text PRIMARY KEY,                         -- STCOFIPS, e.g. "06037"
  state_abbrv    text,
  state_name     text,
  county_name    text,
  population     bigint,
  building_value numeric,                                  -- BUILDVALUE
  agri_value     numeric,                                  -- AGRIVALUE
  area_sq_mi     numeric,                                  -- AREA (sq miles)
  risk_score     numeric,                                  -- RISK_SCORE (composite)
  risk_rating    text,                                     -- RISK_RATNG ("Very Low".."Very High")
  resl_score     numeric,                                  -- community resilience score
  sovi_score     numeric,                                  -- social vulnerability sub-score
  ealb_score     numeric,                                  -- expected annual loss (buildings)
  raw_json       jsonb,                                    -- everything else for forward compat
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nri_county_state
  ON public.risk_nri_county (state_abbrv);
CREATE INDEX IF NOT EXISTS idx_nri_county_risk
  ON public.risk_nri_county (risk_score DESC NULLS LAST);

ALTER TABLE public.risk_nri_county ENABLE ROW LEVEL SECURITY;

-- ── FEMA NRI: census tracts ───────────────────────────────────────────
-- ~84,000 rows. TRACTFIPS (11-digit GEOID) is the natural PK.
CREATE TABLE IF NOT EXISTS public.risk_nri_tract (
  tract_fips     text PRIMARY KEY,                         -- TRACTFIPS, 11-digit
  county_fips    text,                                     -- STCOFIPS first 5 of TRACTFIPS
  state_abbrv    text,
  state_name     text,
  county_name    text,
  population     bigint,
  building_value numeric,
  agri_value     numeric,
  area_sq_mi     numeric,
  risk_score     numeric,
  risk_rating    text,
  resl_score     numeric,
  sovi_score     numeric,
  ealb_score     numeric,
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nri_tract_county
  ON public.risk_nri_tract (county_fips);
CREATE INDEX IF NOT EXISTS idx_nri_tract_state
  ON public.risk_nri_tract (state_abbrv);
CREATE INDEX IF NOT EXISTS idx_nri_tract_risk
  ON public.risk_nri_tract (risk_score DESC NULLS LAST);

ALTER TABLE public.risk_nri_tract ENABLE ROW LEVEL SECURITY;

-- ── CDC Social Vulnerability Index (tract-level) ──────────────────────
-- Source: data.cdc.gov/resource/ypqf-r5qs.json (Socrata, ~73k tracts).
-- Year is included in the dataset; we keep both year and tract in PK so
-- a future re-pull of an older SVI vintage can coexist.
CREATE TABLE IF NOT EXISTS public.svi_tracts (
  tract_fips     text NOT NULL,                            -- 11-digit GEOID (Socrata `fips`)
  data_year      smallint NOT NULL,                        -- e.g. 2020
  state_abbrv    text,
  county_name    text,
  rpl_themes     numeric,                                  -- overall percentile rank
  rpl_theme1     numeric,                                  -- socioeconomic
  rpl_theme2     numeric,                                  -- household composition / disability
  rpl_theme3     numeric,                                  -- minority / language
  rpl_theme4     numeric,                                  -- housing type / transportation
  total_pop      bigint,
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tract_fips, data_year)
);

CREATE INDEX IF NOT EXISTS idx_svi_tracts_state
  ON public.svi_tracts (state_abbrv);
CREATE INDEX IF NOT EXISTS idx_svi_tracts_overall
  ON public.svi_tracts (rpl_themes DESC NULLS LAST);

ALTER TABLE public.svi_tracts ENABLE ROW LEVEL SECURITY;

-- ── Census ACS 5-year by ZCTA (long format) ───────────────────────────
-- One row per (zcta, variable, survey_year). Long format is intentional
-- so we can extend the variable list (B25034_002E built-2020+, etc.)
-- without a schema migration. Wide-format views can sit on top.
--
-- ZCTA5 is the 5-digit ZIP code tabulation area.
CREATE TABLE IF NOT EXISTS public.demo_acs_zcta (
  zcta5          text NOT NULL,
  variable_code  text NOT NULL,                            -- e.g. "B25077_001E"
  value          numeric,
  survey_year    smallint NOT NULL,                        -- ACS 5-yr release, e.g. 2023
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zcta5, variable_code, survey_year)
);

CREATE INDEX IF NOT EXISTS idx_acs_zcta_var
  ON public.demo_acs_zcta (variable_code);
CREATE INDEX IF NOT EXISTS idx_acs_zcta_year
  ON public.demo_acs_zcta (survey_year DESC);

ALTER TABLE public.demo_acs_zcta ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── Apply path ──────────────────────────────────────────────────────
--   pnpm migrate         (preferred — uses Supabase CLI)
--   OR paste into the Supabase SQL editor.
--
-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('risk_nri_county','risk_nri_tract',
--                        'svi_tracts','demo_acs_zcta');
-- Should return 4.
