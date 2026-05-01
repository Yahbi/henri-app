-- 00069_swdi_courtlistener_reo_quakes.sql
-- Wave 1 of the data-acquisition plan
-- (~/.claude/plans/whats-the-14-days-purring-papert.md). Adds 6
-- sidecar feature-store tables that Henri's scoring + lead-detail
-- enrichment can join against:
--
--   weather_swdi_hail        — NOAA SWDI nx3hail radar-derived hail signature
--   weather_swdi_wind        — NOAA SWDI nx3mda mesocyclone / damaging wind
--   weather_swdi_tornado     — NOAA SWDI nx3tvs tornado vortex signature
--   liens_courtlistener      — CourtListener mechanic-lien / lis-pendens dockets
--   foreclosures_fha         — HUD FHA Single-Family REO list
--   quakes_usgs              — USGS event catalog (M2.5+, CONUS bbox)
--
-- Every table is service-role-write only. Reads happen via Henri's
-- existing /api/enrich/* and /api/cron/score routes (also service
-- role). No public/PostgREST exposure — RLS is enabled with no
-- policies, matching the accepted-risk pattern in CLAUDE.md
-- (voter_*, ppp_loans, newsletter_subscribers).
--
-- Idempotent + additive. Re-runs are safe.

BEGIN;

-- ── NOAA SWDI hail (nx3hail) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weather_swdi_hail (
  swdi_uid       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ZTIME from NOAA is the canonical event timestamp (UTC). Treated
  -- as the de-dup key together with lat/lng so re-runs of the cron
  -- don't insert duplicates of the same radar return.
  event_time     timestamptz NOT NULL,
  lat            numeric(8, 5) NOT NULL,
  lng            numeric(8, 5) NOT NULL,
  max_size_mm    numeric(6, 2),
  probability    numeric(4, 2),
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

-- Composite uniqueness — same hail signature = same (timestamp, location)
CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_hail_event
  ON public.weather_swdi_hail (event_time, lat, lng);

-- Lookups by territory bbox + recency
CREATE INDEX IF NOT EXISTS idx_swdi_hail_recent
  ON public.weather_swdi_hail (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_swdi_hail_geo
  ON public.weather_swdi_hail (lat, lng);

ALTER TABLE public.weather_swdi_hail ENABLE ROW LEVEL SECURITY;

-- ── NOAA SWDI wind / mesocyclone (nx3mda) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.weather_swdi_wind (
  swdi_uid       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time     timestamptz NOT NULL,
  lat            numeric(8, 5) NOT NULL,
  lng            numeric(8, 5) NOT NULL,
  max_wind_mph   numeric(6, 2),
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_wind_event
  ON public.weather_swdi_wind (event_time, lat, lng);
CREATE INDEX IF NOT EXISTS idx_swdi_wind_recent
  ON public.weather_swdi_wind (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_swdi_wind_geo
  ON public.weather_swdi_wind (lat, lng);

ALTER TABLE public.weather_swdi_wind ENABLE ROW LEVEL SECURITY;

-- ── NOAA SWDI tornado (nx3tvs) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weather_swdi_tornado (
  swdi_uid       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time     timestamptz NOT NULL,
  lat            numeric(8, 5) NOT NULL,
  lng            numeric(8, 5) NOT NULL,
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_swdi_tornado_event
  ON public.weather_swdi_tornado (event_time, lat, lng);
CREATE INDEX IF NOT EXISTS idx_swdi_tornado_recent
  ON public.weather_swdi_tornado (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_swdi_tornado_geo
  ON public.weather_swdi_tornado (lat, lng);

ALTER TABLE public.weather_swdi_tornado ENABLE ROW LEVEL SECURITY;

-- ── CourtListener mechanic-lien dockets ───────────────────────────────
-- One row per docket. CourtListener docket numbers aren't unique across
-- courts, so we de-dup on (court, docket_number, date_filed).
CREATE TABLE IF NOT EXISTS public.liens_courtlistener (
  lien_uid       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_name      text,
  date_filed     date,
  court          text,                                  -- court slug, e.g. "calsup"
  docket_number  text,
  absolute_url   text,                                  -- courtlistener.com path
  snippet        text,                                  -- text excerpt from search result
  raw_json       jsonb,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_courtlistener_docket
  ON public.liens_courtlistener (court, docket_number, date_filed);
CREATE INDEX IF NOT EXISTS idx_liens_recent
  ON public.liens_courtlistener (date_filed DESC);
CREATE INDEX IF NOT EXISTS idx_liens_case_trgm
  ON public.liens_courtlistener USING gin (case_name gin_trgm_ops);

ALTER TABLE public.liens_courtlistener ENABLE ROW LEVEL SECURITY;

-- ── HUD FHA REO listings ──────────────────────────────────────────────
-- HUD's FeatureServer attribute names are ALL_CAPS — we re-key to
-- snake_case here. case_num is the upstream PRIMARY KEY guarantee.
CREATE TABLE IF NOT EXISTS public.foreclosures_fha (
  case_num            text PRIMARY KEY,
  case_step_number    text,
  street_num          text,
  street_name         text,
  city                text,
  state_code          text,
  zip                 text,
  census_block        text,
  list_date           date,
  list_price          numeric,
  raw_json            jsonb,
  ingested_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fha_reo_zip
  ON public.foreclosures_fha (zip)
  WHERE zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fha_reo_list_date
  ON public.foreclosures_fha (list_date DESC)
  WHERE list_date IS NOT NULL;

ALTER TABLE public.foreclosures_fha ENABLE ROW LEVEL SECURITY;

-- ── USGS earthquakes ──────────────────────────────────────────────────
-- USGS guarantees a stable `id` per event (ComCat).
CREATE TABLE IF NOT EXISTS public.quakes_usgs (
  event_id      text PRIMARY KEY,
  event_time    timestamptz NOT NULL,
  lat           numeric(8, 5),
  lng           numeric(9, 5),
  depth_km      numeric(6, 2),
  magnitude     numeric(4, 2),
  place         text,                                   -- e.g. "12km W of Anza, CA"
  raw_json      jsonb,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quakes_recent
  ON public.quakes_usgs (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_quakes_geo
  ON public.quakes_usgs (lat, lng);
CREATE INDEX IF NOT EXISTS idx_quakes_magnitude
  ON public.quakes_usgs (magnitude DESC);

ALTER TABLE public.quakes_usgs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ── Apply path ──────────────────────────────────────────────────────
--   pnpm migrate          (preferred)
--   OR paste into the Supabase SQL editor.
--
-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('weather_swdi_hail','weather_swdi_wind',
--                        'weather_swdi_tornado','liens_courtlistener',
--                        'foreclosures_fha','quakes_usgs');
-- Should return 6.
