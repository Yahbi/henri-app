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
