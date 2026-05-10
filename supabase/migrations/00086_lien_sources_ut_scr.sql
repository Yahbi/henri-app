-- ─────────────────────────────────────────────────────────────────────
-- 00086 · `lien_sources` registry — preliminary-notice + state-recorder
--          lien feeds, mostly Phase-4 scrape candidates.
--
-- Companion to 00084 (`liens_county_recorder` data table). 00084 created
-- the receiving sidecar; this migration adds the source registry that
-- the rotator picks endpoints from.
--
-- Why a separate migration: 00084 hard-coded GSCCCA (GA) as the first
-- source via direct INSERT. With the 2026-05-08 substitute-layer
-- research adding UT SCR + 6 UCC search portals, we need a proper
-- registry (mirrors contractor_license_sources from 00073/00083).
--
-- The crown jewel: UT State Construction Registry (SCR) — per Utah
-- statute, every contractor on a $5k+ job files a preliminary notice
-- within 20 days. Returns project_address + owner + GC + sub +
-- license + filing_date + amount. Described by 2026-05-08 research as
-- "the GOLD STANDARD construction lead-gen data source nationally."
-- It's HTML-search-only (ASP.NET ViewState scrape), so flagged as
-- Phase 4 work via load_etrakit-style scraper.
--
-- Service-role-write only. RLS enabled with no policies (matches
-- existing accepted-risk pattern).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. lien_sources registry table ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lien_sources (
  source_key       text PRIMARY KEY,
  state_code       text NOT NULL,
  jurisdiction     text NOT NULL DEFAULT 'STATEWIDE',
  -- 'preliminary_notice' | 'mechanics_lien' | 'ucc_filing' | 'recorder_index'
  lien_kind        text NOT NULL,
  -- 'arcgis' | 'socrata' | 'csv' | 'scrape' | 'asp_net_viewstate'
  source_kind      text NOT NULL,
  endpoint_url     text NOT NULL,
  field_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT false,
  -- Phase 4 flag — true means the endpoint requires a custom scraper
  -- (load_etrakit/load_accela/etc.). Set to true for ASP.NET search
  -- portals; false for direct REST/CSV endpoints.
  phase4_scrape    boolean NOT NULL DEFAULT false,
  last_run_at      timestamptz,
  last_count       integer,
  error_count      integer NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lien_sources_state_idx
  ON public.lien_sources (state_code);
CREATE INDEX IF NOT EXISTS lien_sources_enabled_lastrun_idx
  ON public.lien_sources (enabled, last_run_at NULLS FIRST);

ALTER TABLE public.lien_sources ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.lien_sources IS
  'Registry of lien/preliminary-notice/UCC feeds. Service-role-write only. '
  'phase4_scrape=true rows are not auto-enabled by the rotator; they require '
  'a custom scraper run (load_*.py via the Hetzner sidecar).';


-- ── 2. Seed: UT SCR (gold-tier) + 6 UCC search portals ─────────────
-- All start enabled=false. UT SCR is the highest-priority Phase 4
-- target for any contractor doing work in UT.

INSERT INTO public.lien_sources
  (source_key, state_code, jurisdiction, lien_kind, source_kind,
   endpoint_url, field_map, enabled, phase4_scrape, notes)
VALUES
  -- ─── THE PRIZE: UT State Construction Registry ──────────────────
  ('UT-SCR-PRELIMINARY-NOTICES', 'UT', 'STATEWIDE',
   'preliminary_notice', 'asp_net_viewstate',
   'https://secure.utah.gov/scr/scr',
   '{"recording_id":"FilingNumber","filer_name":"FilerName","license_number":"LicenseNumber","filing_date":"FilingDate","project_address":"ProjectAddress","owner_name":"Owner","original_contractor":"OriginalContractor","amount":"Amount"}'::jsonb,
   false, true,
   'GOLD STANDARD nationally. UT statute requires every contractor on $5k+ job to file preliminary notice within 20 days. ~250k+ filings/yr. Search-only ASP.NET — needs load_scr.py with ViewState handling. Phase 4 priority above Honolulu DPP.'),

  -- ─── UCC Search portals (lower priority — equipment-financing signal only) ──
  ('UT-UCC-FILINGS', 'UT', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://secure.utah.gov/uccs/uccs',
   '{"recording_id":"FilingNumber","debtor_name":"DebtorName","secured_party":"SecuredParty","filing_date":"FilingDate","collateral":"Collateral"}'::jsonb,
   false, true,
   'UT UCC Online. Equipment-financing proxy for active contractors. Lower priority than SCR.'),

  ('ME-UCC-FILINGS', 'ME', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://www1.maine.gov/online/sos/ucc/search/searchucc.do',
   '{"recording_id":"FilingNumber","debtor_name":"DebtorName","secured_party":"SecuredParty","filing_date":"FilingDate"}'::jsonb,
   false, true,
   'ME has no statewide mechanics-lien index — those file at county Registry of Deeds. UCC is the closest substitute.'),

  ('MS-UCC-FILINGS', 'MS', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://uccnet.sos.ms.gov/SOSUCC/SOSUCC/Public/UccSearch.aspx',
   '{}'::jsonb,
   false, true,
   'ASP.NET ViewState scrape. Field-map TBD on first scrape pass.'),

  ('NH-UCC-FILINGS', 'NH', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://quickstart.sos.nh.gov/online/UccSearch',
   '{}'::jsonb,
   false, true,
   'NH QuickStart UCC search.'),

  ('OK-UCC-FILINGS', 'OK', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://www.sos.ok.gov/corp/ucc/UCCSearch.aspx',
   '{}'::jsonb,
   false, true,
   'OK SOS UCC.'),

  ('RI-UCC-FILINGS', 'RI', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://business.sos.ri.gov/UCCSearchExternal/UCCSearchExternal.aspx',
   '{}'::jsonb,
   false, true,
   'RI SOS UCC. Useful proxy for mechanics-lien-style filings on equipment/contractors.'),

  ('WV-UCC-FILINGS', 'WV', 'STATEWIDE', 'ucc_filing', 'asp_net_viewstate',
   'https://apps.wv.gov/sos/ucc/search/Default.aspx',
   '{}'::jsonb,
   false, true,
   'WV SOS UCC.')
ON CONFLICT (source_key) DO UPDATE
  SET endpoint_url   = EXCLUDED.endpoint_url,
      field_map      = EXCLUDED.field_map,
      phase4_scrape  = EXCLUDED.phase4_scrape,
      notes          = EXCLUDED.notes,
      updated_at     = now();


-- ── 3. moddatetime trigger ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TRIGGER lien_sources_moddatetime
    BEFORE UPDATE ON public.lien_sources
    FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ── 4. Add net-new license-roster sources for the dead-permit states
--      that 00083 didn't cover (NH, RI, MS, WV — all SEARCH_ONLY).
-- ME + OK + UT were already covered in 00083.
INSERT INTO public.contractor_license_sources
  (state_code, state_name, source_kind, endpoint_url, field_map, enabled, notes)
VALUES
  ('NH', 'New Hampshire', 'scrape',
   'https://elicense.oplc.nh.gov/Verification/Search.aspx',
   '{"license_number":"LicenseNumber","name":"Name","license_type":"LicenseType","license_status":"Status","expiry":"ExpirationDate","city":"City"}'::jsonb,
   false,
   'NH OPLC Thentia eLicense portal. Search-only ASP.NET. Phase 4 scrape required. Trades only (electricians, plumbers, gas-fitters) — no GC license in NH.'),

  ('RI', 'Rhode Island', 'scrape',
   'https://crb.ri.gov/contractor-search',
   '{"license_number":"RegistrationNumber","name":"Name","license_type":"WorkClassification","license_status":"Status","city":"City","phone":"Phone"}'::jsonb,
   false,
   'RI Contractors Registration Board. STRONGEST single source for RI contractor leads — registers ALL residential contractors (general/remodeling/additions). Search-only HTML; Phase 4 scrape. Returns phone — direct phone-fill.'),

  ('MS', 'Mississippi', 'scrape',
   'https://msbcl.ms.gov/onlineverification/Lookup.aspx',
   '{"license_number":"LicenseNumber","name":"Name","license_type":"Classification","license_status":"Status","expiry":"Expiration"}'::jsonb,
   false,
   'MS State Board of Contractors. Search-only. Phase 4 scrape.'),

  ('WV', 'West Virginia', 'scrape',
   'https://apps.wv.gov/sos/businesssearch/',
   '{"license_number":"LicenseNumber","name":"Name","license_type":"Classification","license_status":"Status"}'::jsonb,
   false,
   'WV Division of Labor Contractor Licensing. SoS business-registration CSV may be downloadable. Phase 4 — investigate bulk path before scraping.')
ON CONFLICT (state_code) DO UPDATE
  SET endpoint_url = EXCLUDED.endpoint_url,
      field_map    = EXCLUDED.field_map,
      notes        = EXCLUDED.notes,
      updated_at   = now();


COMMIT;
