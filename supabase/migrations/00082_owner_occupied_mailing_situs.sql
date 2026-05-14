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
