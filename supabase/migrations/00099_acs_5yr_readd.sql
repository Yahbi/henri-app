-- 00099_acs_5yr_readd.sql
--
-- Re-adds the `demo_acs_zcta` sidecar table that was dropped in migration
-- 00079 because no consumers existed at that time. The 2026-05-12 v2 free-
-- data catalog audit identifies ACS 5-year as worth re-adding now that
-- there are use cases for it:
--   - Score cron's `zip_demand_scores` enrichment (median household income
--     + housing tenure + cost-burden as demand signals)
--   - Outreach hygiene (skip ZIPs with majority renter-occupied housing
--     since the wedge targets homeowners)
--   - Contractor tier pricing (use median home value to set per-state
--     territory price tiers)
--
-- Schema matches what the original `census-acs` cron route in
-- `src/app/api/cron/census-acs/route.ts` already writes to. Re-running
-- that cron will populate the table.
--
-- Idempotent — re-running this migration is safe.

BEGIN;

CREATE TABLE IF NOT EXISTS public.demo_acs_zcta (
  zcta                    text PRIMARY KEY,             -- 5-digit ZIP/ZCTA
  state_code              text,
  population              integer,
  median_household_income integer,
  median_home_value       integer,
  median_year_built       integer,
  median_age              numeric,
  pct_owner_occupied      numeric,   -- 0.0 to 1.0
  pct_renter_occupied     numeric,   -- 0.0 to 1.0
  pct_housing_cost_burdened numeric, -- 0.0 to 1.0 (>30% of income on housing)
  pct_built_pre_1980      numeric,   -- 0.0 to 1.0 (aging housing stock proxy)
  housing_units_total     integer,
  housing_units_occupied  integer,
  housing_units_vacant    integer,
  raw_json                jsonb,
  acs_year                smallint,                     -- e.g. 2022 for 5-yr 2018-2022
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_acs_zcta_state
  ON public.demo_acs_zcta (state_code);
CREATE INDEX IF NOT EXISTS idx_demo_acs_zcta_income
  ON public.demo_acs_zcta (median_household_income DESC NULLS LAST)
  WHERE median_household_income IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_acs_zcta_owner_pct
  ON public.demo_acs_zcta (pct_owner_occupied DESC NULLS LAST)
  WHERE pct_owner_occupied IS NOT NULL;

ALTER TABLE public.demo_acs_zcta ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE TRIGGER demo_acs_zcta_updated_at
  BEFORE UPDATE ON public.demo_acs_zcta
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.demo_acs_zcta IS
  '00099 - Census ACS 5-year ZCTA-level demographics (re-add of 00079-pruned table). Source: api.census.gov/data/{year}/acs/acs5. Populated by /api/cron/census-acs cron route. Used by score cron + outreach hygiene + contractor tier pricing.';

COMMIT;
