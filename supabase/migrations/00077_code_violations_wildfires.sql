-- 00077_code_violations_wildfires.sql
-- Wave 2.C of the data-acquisition plan
-- (~/.claude/plans/whats-the-14-days-purring-papert.md). Adds 2 new
-- canonical-data-layer tables that close out the next slice of
-- contractor-lead signals:
--
--   code_violations         — major-city open-data code violations
--                            (NYC DOB / Chicago / SF). Direct
--                            contractor lead — properties cited for
--                            failed inspection, broken siding,
--                            non-permitted work need contractors.
--   wildfires_nifc          — current US wildfire incidents from the
--                            NIFC ArcGIS service. Restoration /
--                            cleanup / tree-removal trigger,
--                            especially in CA / CO / OR / AZ / NM.
--
-- Service-role-write only. RLS-on, no policies (matches accepted-risk
-- pattern). Idempotent + additive — re-runs are safe.

BEGIN;

-- ── Code violations (major-city Socrata feeds) ──────────────────────
-- Long-format storage so we can mix shapes from NYC DOB / Chicago /
-- SF without per-city tables. `jurisdiction` is the source key
-- ('nyc_dob' / 'chicago' / 'sf'); `violation_id` is the upstream
-- per-row unique id. Composite PK absorbs cross-source dupes.
CREATE TABLE IF NOT EXISTS public.code_violations (
  jurisdiction        text NOT NULL,                          -- 'nyc_dob' / 'chicago' / 'sf'
  violation_id        text NOT NULL,                          -- upstream id
  state               text,                                   -- 'NY' / 'IL' / 'CA'
  city                text,
  zip                 text,
  street_address      text,
  violation_type      text,                                   -- code-class summary
  violation_status    text,                                   -- 'OPEN' / 'CLOSED' / 'ACTIVE'
  issue_date          date,
  description         text,
  raw_json            jsonb,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jurisdiction, violation_id)
);

CREATE INDEX IF NOT EXISTS idx_code_violations_zip
  ON public.code_violations (zip)
  WHERE zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_code_violations_state
  ON public.code_violations (state);
CREATE INDEX IF NOT EXISTS idx_code_violations_recent
  ON public.code_violations (issue_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_code_violations_status
  ON public.code_violations (violation_status)
  WHERE violation_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_code_violations_address_trgm
  ON public.code_violations USING gin (street_address gin_trgm_ops);

ALTER TABLE public.code_violations ENABLE ROW LEVEL SECURITY;

-- ── Wildfires (NIFC current-year ArcGIS) ────────────────────────────
-- The NIFC WFIGS_Incident_Locations_Current FeatureServer ships a
-- stable IRWIN ID per incident (`IrwinID`) which is the natural PK.
CREATE TABLE IF NOT EXISTS public.wildfires_nifc (
  irwin_id            text PRIMARY KEY,
  incident_name       text,
  incident_type       text,                                   -- e.g. 'Wildfire' / 'Prescribed Fire'
  state               text,
  county              text,
  fire_cause          text,
  acres_burned        numeric,
  containment_pct     numeric,                                -- 0-100
  discovery_date      timestamptz,
  modified_date       timestamptz,                            -- upstream last-modified
  fire_status         text,                                   -- 'Out' / 'Active' / etc.
  lat                 numeric(10, 7),
  lng                 numeric(10, 7),
  raw_json            jsonb,
  ingested_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wildfires_state
  ON public.wildfires_nifc (state);
CREATE INDEX IF NOT EXISTS idx_wildfires_recent
  ON public.wildfires_nifc (discovery_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wildfires_status
  ON public.wildfires_nifc (fire_status);
CREATE INDEX IF NOT EXISTS idx_wildfires_geo
  ON public.wildfires_nifc (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

ALTER TABLE public.wildfires_nifc ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('code_violations','wildfires_nifc');
-- Should return 2.
