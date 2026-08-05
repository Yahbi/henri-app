-- 00124_repair_house_number_zips.sql
--
-- Batched repair for permits whose `zip` holds the LEADING HOUSE NUMBER
-- instead of the ZIP code.
--
-- ─── The damage ─────────────────────────────────────────────────────────
-- `extractZip` used to be a NON-global `address.match(/\b(\d{5})\b/)`, so it
-- returned the FIRST five-digit run in the string. Whenever the house number
-- is five digits, that is the house number:
--
--   "11848 HOOPER RD  BAKER LA 70714"      -> "11848"
--   "33647 GREENWELL SPRINGS RD, LA 70739" -> "33647"
--
-- ZIP is the territory key for the whole paid product, so a Baton Rouge
-- property numbered 33647 was delivered into the Tampa 33647 exclusive
-- territory. It also poisoned `permits.state`, because `deriveState` fed the
-- bogus ZIP to the USPS prefix table (118xx -> "NY").
--
-- The scraper is already fixed (src/lib/scrapers/normalizer.ts: take the LAST
-- five-digit token, reject it at index 0). The ~130,000 stored rows are not.
--
-- ─── Why a batched FUNCTION and not one UPDATE ──────────────────────────
-- Identical reasoning to 00120, which is the reference implementation for
-- this shape. Bulk UPDATEs through the Management API saturated the
-- connection pool, PostgREST started returning PGRST002, and the whole data
-- layer was unavailable for ~10 minutes while the project still reported
-- ACTIVE_HEALTHY. Every PostgREST call inherits the `authenticator` role's
-- 8s statement_timeout, so the repair does ONE bounded batch per call and
-- returns how many rows it fixed. The caller loops.
--
-- ─── scored_at: why this one does NOT blanket-reset ─────────────────────
-- 00120 could set `scored_at = NULL` on every row it touched because those
-- permits carried a NULL zip, were therefore invisible to territory
-- matching, and provably had ZERO leads referencing them.
--
-- These rows are the opposite case. They carried a (wrong) ZIP the whole
-- time, which means they DID reach territory matching and some of them
-- produced leads — in the wrong contractor's territory. Re-scoring is not
-- free: the score cron's lead upsert hardcodes `status: 'new'` and
-- overwrites `notes`, so a lead a contractor had marked contacted or won
-- would revert to "new" with its notes wiped while keeping contacted_at /
-- won_at populated. That is destroying customer work to fix our data.
--
-- So the rule here is:
--   * permit has NO lead  -> safe to re-queue, `scored_at = NULL`. Nothing
--     downstream holds state, and re-scoring is what puts the row into the
--     RIGHT territory.
--   * permit HAS a lead   -> `scored_at` is left exactly as it is. The zip
--     and state columns are still corrected (the drawer and any future
--     re-score then see the truth), but no pipeline state is disturbed and
--     no notification or SMS re-fires.
--
-- The lead-bearing rows are a wedge problem, not a data problem: they are
-- permits currently delivered to a contractor who does not own the real
-- ZIP. That needs a human decision (release the lock? notify? refund the
-- month?), so this function deliberately refuses to make it silently. Run
-- the pre-flight query below BEFORE the repair to see exactly which leads
-- are affected, while `zip` still holds the bogus value that matched them.
--
-- ─── Operator runbook ───────────────────────────────────────────────────
--   -- 0. PRE-FLIGHT (run first, and keep the output): which live leads sit
--   --    on a permit whose ZIP is really a house number?
--   select l.id as lead_id, l.contractor_id, l.status,
--          p.id as permit_id, p.zip as bogus_zip, p.state, p.address
--     from public.leads l
--     join public.permits p on p.id = l.permit_id
--    where p.zip is not null and p.address is not null
--      and p.zip = substring(p.address from '^[0-9]{5}(?![0-9])')
--      and public.henri_extract_zip(p.address) is distinct from p.zip;
--
--   -- 1. repair, one batch at a time, from the app (service-role client):
--   select public.repair_house_number_zips(2000);   -- returns rows repaired
--   -- repeat until it returns 0, then:
--   drop index if exists public.idx_permits_housenum_zip_repair;
--   -- 2. refresh the marketing cache so the corrected ZIPs are counted:
--   GET /api/cron/refresh-landing-stats
--
-- Start at 2000 and only raise it if calls return well under a second.
-- Idempotent: re-running after completion is a no-op, and re-applying the
-- migration only replaces the functions.

-- ── Helpers: SQL ports of the fixed scraper normalizer ──────────────────
-- These mirror src/lib/scrapers/normalizer.ts exactly. They are IMMUTABLE
-- because the partial index below has to reference row-local expressions
-- only, and because a repair must be reproducible: the same address must
-- always yield the same ZIP.

-- Port of `extractZip`. Last five-digit token wins; a token at position 0
-- is the house number, never a ZIP.
CREATE OR REPLACE FUNCTION public.henri_extract_zip(p_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH tok AS (
    SELECT m[1] AS zip, ord
      FROM regexp_matches(COALESCE(p_address, ''),
                          '\y([0-9]{5})(-[0-9]{4})?\y', 'g')
           WITH ORDINALITY AS t(m, ord)
  )
  SELECT CASE
           -- Exactly one token AND the address opens with it: that is the
           -- house number. JS returned null here; so do we.
           WHEN (SELECT count(*) FROM tok) = 1
            AND COALESCE(p_address, '') ~ '^[0-9]{5}(?![0-9])'
           THEN NULL
           ELSE (SELECT zip FROM tok ORDER BY ord DESC LIMIT 1)
         END
$$;

COMMENT ON FUNCTION public.henri_extract_zip(text) IS
  'SQL port of extractZip() in src/lib/scrapers/normalizer.ts: last 5-digit '
  'token in the address, NULL when the only token is the leading house '
  'number. Keep the two in sync.';

-- Port of `zipToState`: USPS leading-3-digit prefix ranges.
CREATE OR REPLACE FUNCTION public.henri_zip_to_state(p_zip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_zip IS NULL OR p_zip !~ '^[0-9]{3}' THEN NULL
    ELSE (
      SELECT CASE
        WHEN n BETWEEN  10 AND  27 THEN 'MA' WHEN n BETWEEN  28 AND  29 THEN 'RI'
        WHEN n BETWEEN  30 AND  38 THEN 'NH' WHEN n BETWEEN  39 AND  49 THEN 'ME'
        WHEN n BETWEEN  50 AND  59 THEN 'VT' WHEN n BETWEEN  60 AND  69 THEN 'CT'
        WHEN n BETWEEN  70 AND  89 THEN 'NJ' WHEN n = 5                 THEN 'NY'
        WHEN n BETWEEN 100 AND 149 THEN 'NY' WHEN n BETWEEN 150 AND 196 THEN 'PA'
        WHEN n BETWEEN 197 AND 199 THEN 'DE' WHEN n BETWEEN 200 AND 205 THEN 'DC'
        WHEN n BETWEEN 206 AND 219 THEN 'MD' WHEN n BETWEEN 220 AND 246 THEN 'VA'
        WHEN n BETWEEN 247 AND 268 THEN 'WV' WHEN n BETWEEN 270 AND 289 THEN 'NC'
        WHEN n BETWEEN 290 AND 299 THEN 'SC'
        WHEN n BETWEEN 300 AND 319 OR n BETWEEN 398 AND 399 THEN 'GA'
        WHEN n BETWEEN 320 AND 349 THEN 'FL' WHEN n BETWEEN 350 AND 369 THEN 'AL'
        WHEN n BETWEEN 370 AND 385 THEN 'TN' WHEN n BETWEEN 386 AND 397 THEN 'MS'
        WHEN n BETWEEN 400 AND 427 THEN 'KY' WHEN n BETWEEN 430 AND 459 THEN 'OH'
        WHEN n BETWEEN 460 AND 479 THEN 'IN' WHEN n BETWEEN 480 AND 499 THEN 'MI'
        WHEN n BETWEEN 500 AND 528 THEN 'IA' WHEN n BETWEEN 530 AND 549 THEN 'WI'
        WHEN n BETWEEN 550 AND 567 THEN 'MN' WHEN n BETWEEN 570 AND 577 THEN 'SD'
        WHEN n BETWEEN 580 AND 588 THEN 'ND' WHEN n BETWEEN 590 AND 599 THEN 'MT'
        WHEN n BETWEEN 600 AND 629 THEN 'IL' WHEN n BETWEEN 630 AND 658 THEN 'MO'
        WHEN n BETWEEN 660 AND 679 THEN 'KS' WHEN n BETWEEN 680 AND 693 THEN 'NE'
        WHEN n BETWEEN 700 AND 714 THEN 'LA' WHEN n BETWEEN 716 AND 729 THEN 'AR'
        WHEN n BETWEEN 730 AND 749 THEN 'OK' WHEN n BETWEEN 750 AND 799 THEN 'TX'
        WHEN n BETWEEN 800 AND 816 THEN 'CO' WHEN n BETWEEN 820 AND 831 THEN 'WY'
        WHEN n BETWEEN 832 AND 838 THEN 'ID' WHEN n BETWEEN 840 AND 847 THEN 'UT'
        WHEN n BETWEEN 850 AND 865 THEN 'AZ' WHEN n BETWEEN 870 AND 884 THEN 'NM'
        WHEN n BETWEEN 889 AND 898 THEN 'NV' WHEN n BETWEEN 900 AND 961 THEN 'CA'
        WHEN n BETWEEN 967 AND 968 THEN 'HI' WHEN n BETWEEN 970 AND 979 THEN 'OR'
        WHEN n BETWEEN 980 AND 994 THEN 'WA' WHEN n BETWEEN 995 AND 999 THEN 'AK'
        ELSE NULL
      END
      FROM (SELECT substring(p_zip from 1 for 3)::int AS n) z
    )
  END
$$;

COMMENT ON FUNCTION public.henri_zip_to_state(text) IS
  'SQL port of zipToState() in src/lib/scrapers/normalizer.ts. Keep in sync.';

-- Port of the first branch of `deriveState`: the explicit trailing
-- ", ST 12345" token. This is the only state signal on the row that is
-- authoritative — it was written by the jurisdiction, not inferred by us.
CREATE OR REPLACE FUNCTION public.henri_state_from_address(p_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN t.st IN (
             'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
             'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
             'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
             'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
             'WI','WY','DC'
           ) THEN t.st
           ELSE NULL
         END
    FROM (
      SELECT (regexp_match(
                upper(COALESCE(p_address, '')),
                ',?\s*([A-Z]{2})\s+[0-9]{5}(-[0-9]{4})?\s*$'))[1] AS st
    ) t
$$;

COMMENT ON FUNCTION public.henri_state_from_address(text) IS
  'SQL port of the address-token branch of deriveState() in '
  'src/lib/scrapers/normalizer.ts. Keep in sync.';

-- ── Repair index ────────────────────────────────────────────────────────
-- Makes each batch an index scan instead of a seq scan over 2.25M rows.
-- The predicate is intentionally the CHEAP superset test (does `zip` equal
-- the address's leading five-digit token?); the function above does the
-- precise work inside the batch. Drop it once the repair is done — it
-- exists only for this migration.
--
-- This is a plain CREATE INDEX, matching 00120. It takes a lock that blocks
-- writes to `permits` for the duration. If the ingest crons are running,
-- build it by hand first with
--   CREATE INDEX CONCURRENTLY idx_permits_housenum_zip_repair ...
-- and the IF NOT EXISTS below turns into a no-op.
CREATE INDEX IF NOT EXISTS idx_permits_housenum_zip_repair
  ON public.permits (id)
  WHERE zip IS NOT NULL
    AND address IS NOT NULL
    AND zip = substring(address from '^[0-9]{5}(?![0-9])');

CREATE OR REPLACE FUNCTION public.repair_house_number_zips(p_batch int DEFAULT 2000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  -- Bound the batch so a caller can't accidentally reproduce the outage
  -- this function exists to avoid.
  IF p_batch IS NULL OR p_batch < 1 THEN p_batch := 2000; END IF;
  IF p_batch > 5000 THEN p_batch := 5000; END IF;

  WITH cand AS (
    SELECT p.id,
           public.henri_extract_zip(p.address) AS new_zip
      FROM public.permits p
     WHERE p.zip IS NOT NULL
       AND p.address IS NOT NULL
       AND p.zip = substring(p.address from '^[0-9]{5}(?![0-9])')
       -- Filter no-ops BEFORE the LIMIT. A handful of rows legitimately
       -- have house number = ZIP; if they could enter the batch they would
       -- consume the whole limit, the function would return 0, and the
       -- operator's loop would stop while real candidates remained.
       AND public.henri_extract_zip(p.address) IS DISTINCT FROM p.zip
     LIMIT p_batch
  ), upd AS (
    UPDATE public.permits p SET
      -- NULL is a legitimate outcome: an address that carries only a house
      -- number has no recoverable ZIP, and no ZIP is strictly better than a
      -- wrong one that routes the property into another city's exclusive
      -- territory.
      zip = cand.new_zip,
      -- Strictly-better state derivation. The stored state was inferred
      -- from the house number's USPS prefix, so anything is an improvement:
      -- the jurisdiction-written address token first, then the corrected
      -- ZIP's prefix, then leave it alone for 00123 to judge against the
      -- coordinates.
      state = COALESCE(
                public.henri_state_from_address(p.address),
                public.henri_zip_to_state(cand.new_zip),
                p.state),
      -- See the scored_at section in the header. Re-queue only the rows
      -- that hold no contractor pipeline state.
      scored_at = CASE
                    WHEN EXISTS (SELECT 1 FROM public.leads l
                                  WHERE l.permit_id = p.id)
                    THEN p.scored_at
                    ELSE NULL
                  END,
      updated_at = now()
    FROM cand
    WHERE p.id = cand.id
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upd;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.repair_house_number_zips(int) IS
  'Repairs one bounded batch of permits whose zip holds the leading house '
  'number, re-deriving zip and state from the address. Re-queues for '
  'scoring ONLY permits with no lead, so contractor pipeline state is never '
  'reverted. Returns rows repaired; call in a loop until it returns 0. '
  'Batched deliberately: bulk UPDATEs on this table exhaust the connection '
  'pool and take PostgREST down. See 00124 for the runbook.';

REVOKE EXECUTE ON FUNCTION public.repair_house_number_zips(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repair_house_number_zips(int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.henri_extract_zip(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.henri_zip_to_state(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.henri_state_from_address(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.henri_extract_zip(text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.henri_zip_to_state(text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.henri_state_from_address(text) TO service_role;
