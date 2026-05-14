-- 00098_v2_sidecar_tables.sql
--
-- Creates 5 new sidecar tables identified as architecturally-required by the
-- 2026-05-12 v2 free-data catalog audit (companion doc:
-- docs/permit-catalog/free-data-sources-v2-2026-05-12.md).
--
-- These tables hold data classes Henri's existing schema doesn't model:
--
-- 1. mortgage_originations  → HMDA loan-level (refi/cash-out/home-improvement
--                              signals 1-6mo before permit pulls)
-- 2. recorder_events        → NYC ACRIS + King WA + future county-recorder
--                              feeds (DEED/MTGE/SAT/LP/NLP/foreclosure)
-- 3. enforcement_actions    → FTC + CFPB + state AG enforcement actions
--                              against named defendants (contractor trust
--                              filter)
-- 4. market_metrics_zip     → Redfin + Realtor.com + Zillow ZIP-level demand
--                              aggregates (territory pricing + outreach
--                              prioritization)
-- 5. discipline_actions     → State licensing-board disciplinary actions
--                              separate from license rosters themselves
--                              (WA L&I debar, CSLB CA, FL DBPR, etc.)
--
-- All tables follow the existing Henri sidecar pattern:
--   - Service-role-write only (no client INSERT/UPDATE policy)
--   - RLS enabled with NO read policies (only service role + future explicit
--     contractor-side policies can SELECT)
--   - Each row carries a raw_json jsonb for forensic replay
--   - created_at timestamptz NOT NULL DEFAULT now() for audit
--
-- Idempotent — re-running this migration is safe.
--
-- After this migration lands, the consumer-side work that follows in a
-- separate session is:
--   a) Hetzner loaders for each source (HMDA bulk CSV / NYC ACRIS Socrata /
--      FTC docket scrape / Redfin S3 / WA L&I debar scrape)
--   b) Score-cron extensions to use these signals as additional boosters
--      (mortgage_originations within 6 months → +2-4 booster on lead score)
--   c) Lead-drawer panels to surface the signals to contractors
--      ("Recent cash-out refi nearby" / "Property in lis pendens nearby" /
--       "Contractor flagged in FTC docket"). Phase 5 follow-up.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. mortgage_originations — HMDA loan-level
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mortgage_originations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_year   smallint NOT NULL,
  lei             text,                -- Legal Entity Identifier (lender)
  loan_type       smallint,            -- 1=Conventional, 2=FHA, 3=VA, 4=USDA
  loan_purpose    smallint,            -- 1=Home purchase, 2=Home improvement,
                                       -- 31=Refi, 32=Cash-out refi,
                                       -- 4=Other, 5=Not applicable
  loan_amount     integer,
  property_value  integer,
  state_code      text,
  county_code     text,                -- FIPS county code
  census_tract    text,
  msa_md          text,                -- Metropolitan Statistical Area
  applicant_income integer,
  action_taken    smallint,            -- 1=Originated, 2=Approved-not-accepted,
                                       -- 3=Denied, 4=Withdrawn, 5=Incomplete,
                                       -- 6=Purchased loan
  denial_reason_1 text,
  raw_json        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mortgage_originations_year_purpose
  ON public.mortgage_originations (activity_year, loan_purpose);
CREATE INDEX IF NOT EXISTS idx_mortgage_originations_state_tract
  ON public.mortgage_originations (state_code, census_tract);
CREATE INDEX IF NOT EXISTS idx_mortgage_originations_county
  ON public.mortgage_originations (state_code, county_code);

ALTER TABLE public.mortgage_originations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mortgage_originations IS
  '00098 - HMDA loan-level originations. Source: CFPB Data Browser API. Filter loan_purpose IN (2, 31, 32) for home-improvement + refi + cash-out signals. Census-tract grain — join to parcel_sources for street-level enrichment. Annual full + quarterly refresh.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. recorder_events — county recorder filings (deed, mortgage, lis pendens)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recorder_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key      text NOT NULL,        -- NY-NYC-ACRIS, WA-KING-COUNTY, etc.
  document_id     text NOT NULL,        -- Source's unique document ID
  doc_type        text NOT NULL,        -- DEED, MTGE, SAT, LP, NLP, NOD,
                                        -- FORECLOSURE, MISC, etc.
  doc_date        date,
  doc_amount      numeric,
  recorded_date   date,
  state_code      text,
  county          text,
  city            text,
  parcel_id       text,                 -- BBL for NYC, APN elsewhere
  party_grantor   text,                 -- Seller/Mortgagor/Defendant
  party_grantee   text,                 -- Buyer/Lender/Plaintiff
  address         text,
  zip             text,
  raw_json        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, document_id)
);

CREATE INDEX IF NOT EXISTS idx_recorder_events_doc_date
  ON public.recorder_events (doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_recorder_events_state_doctype_date
  ON public.recorder_events (state_code, doc_type, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_recorder_events_parcel
  ON public.recorder_events (parcel_id);
CREATE INDEX IF NOT EXISTS idx_recorder_events_zip_date
  ON public.recorder_events (zip, doc_date DESC)
  WHERE zip IS NOT NULL;

ALTER TABLE public.recorder_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.recorder_events IS
  '00098 - County recorder document filings. Source: NYC ACRIS Socrata (bnx9-e6tj) + King County WA Socrata (nx4x-daw6) + future statewide/county feeds. doc_type values include DEED (sale), MTGE (mortgage), SAT (mortgage payoff = likely refi/sale within 60d), LP/NLP (lis pendens = pre-foreclosure distress), FORECLOSURE. Wires into the lien_sources registry table.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. enforcement_actions — FTC + CFPB + state AG enforcement against
--    named defendants
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enforcement_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,      -- ftc | cfpb | state_ag_<state>
  action_date       date,
  defendant_name    text,                -- Primary defendant; companion table
                                         -- not modeled (multi-defendant
                                         -- normalisation deferred)
  case_number       text,
  enforcement_type  text,                -- cease_and_desist | settlement |
                                         -- judgment | penalty_offense |
                                         -- consent_decree | complaint |
                                         -- final_order | etc.
  penalty_amount    numeric,
  statute           text,                -- e.g. "FTC Act §5"
  jurisdiction      text,                -- US | per-state
  industry_category text,                -- "home_improvement" | "financial"
                                         -- | other (lets us filter to
                                         -- Henri-relevant cases on read)
  summary           text,
  source_url        text,
  raw_json          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, case_number)
);

CREATE INDEX IF NOT EXISTS idx_enforcement_actions_defendant_name
  ON public.enforcement_actions (lower(defendant_name));
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_action_date
  ON public.enforcement_actions (action_date DESC);
CREATE INDEX IF NOT EXISTS idx_enforcement_actions_industry
  ON public.enforcement_actions (industry_category, action_date DESC)
  WHERE industry_category IS NOT NULL;

ALTER TABLE public.enforcement_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.enforcement_actions IS
  '00098 - Federal + state enforcement actions against named defendants. Source: FTC Cases & Proceedings + FTC Home Improvement Penalty Offenses + CFPB Consumer Complaint DB + state AG press releases. Name-match against contractor_license_sources roster to filter contractors with active or recent enforcement history before routing leads.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. market_metrics_zip — Redfin + Realtor.com + Zillow ZIP-level
--    real-estate demand aggregates
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_metrics_zip (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip                      text NOT NULL,
  period_date              date NOT NULL,
  source                   text NOT NULL,    -- redfin | realtor | zillow
  median_list_price        numeric,
  median_sale_price        numeric,
  median_days_on_market    integer,
  new_listing_count        integer,
  price_reduced_count      integer,
  inventory_count          integer,
  pending_count            integer,
  zhvi_typical_value       numeric,          -- Zillow Home Value Index
  zori_observed_rent       numeric,          -- Zillow Observed Rent Index
  raw_json                 jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zip, period_date, source)
);

CREATE INDEX IF NOT EXISTS idx_market_metrics_zip_zip_date
  ON public.market_metrics_zip (zip, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_zip_period_source
  ON public.market_metrics_zip (period_date DESC, source);

ALTER TABLE public.market_metrics_zip ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.market_metrics_zip IS
  '00098 - ZIP-level real-estate market metrics. Sources: Redfin Data Center ZIP Tracker (S3 weekly, 101MB), Realtor.com Inventory Core Metrics ZIP CSV (S3 weekly, 7.2MB), Zillow Research ZHVI/ZORI (CSV monthly). Period_date is the snapshot date for the metric. UNIQUE (zip, period_date, source) prevents duplicates across runs.';

-- ─────────────────────────────────────────────────────────────────────
-- 5. discipline_actions — state licensing-board disciplinary actions
--    (separate from license rosters)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discipline_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code          text NOT NULL,
  source_key          text NOT NULL,        -- WA-LI-DEBAR | CSLB-CA |
                                            -- FL-DBPR-DISCIPLINE |
                                            -- NYC-DCWP-COMPLAINTS | etc.
  license_number      text,                  -- Cross-reference to
                                            -- state_license_rosters
  contractor_name     text,
  business_name       text,
  action_date         date,
  action_type         text,                  -- debarment | suspension |
                                            -- revocation | citation |
                                            -- warning | complaint | etc.
  statute             text,
  penalty_amount      numeric,
  bond_claim_amount   numeric,
  description         text,
  source_url          text,
  is_active_bar       boolean DEFAULT false, -- Currently barred from
                                            -- contracting? (debar-list flag)
  raw_json            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discipline_actions_state_license
  ON public.discipline_actions (state_code, license_number)
  WHERE license_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discipline_actions_contractor_name
  ON public.discipline_actions (lower(contractor_name));
CREATE INDEX IF NOT EXISTS idx_discipline_actions_active_bar
  ON public.discipline_actions (state_code)
  WHERE is_active_bar = true;
CREATE INDEX IF NOT EXISTS idx_discipline_actions_action_date
  ON public.discipline_actions (action_date DESC);

ALTER TABLE public.discipline_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.discipline_actions IS
  '00098 - State licensing-board disciplinary actions. Source: WA L&I Debarred Contractors HTML (high-signal binary flag) + WA L&I per-license-detail Infractions + Lawsuits Against Bond + CSLB CA Disciplinary Actions Library + TDLR TX Enforcement Monthly + NYC DCWP Consumer Complaints + per-state PDFs. Joins to state_license_rosters by (state_code, license_number).';

COMMIT;
