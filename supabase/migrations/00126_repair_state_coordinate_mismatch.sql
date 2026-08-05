-- 00126_repair_state_coordinate_mismatch.sql
--
-- Batched repair for permits attributed to one state while carrying another
-- state's coordinates.
--
-- DEPENDS ON 00121 — reuses public.henri_state_from_address() and
-- public.henri_zip_to_state(). Migrations apply in numeric order, so this
-- is satisfied by default; if you cherry-pick, apply 00121 first.
--
-- ─── The damage ─────────────────────────────────────────────────────────
-- `deriveState` used to let a ZIP-prefix lookup outrank the source's own
-- declared state. Combined with the house-number-as-ZIP bug (00121), a feed
-- that declares "WA" produced rows stored as "NY": the address opened with
-- a five-digit house number in the 100xx range, the prefix table said New
-- York, and that beat the jurisdiction's own declaration. A prior sweep
-- found 251 sampled permits sitting at Seattle coordinates
-- (47.68 / -122.32) stored as NY.
--
-- The scraper is fixed (`zipIsTrusted` demotes a free-text-parsed ZIP below
-- the declared state). The stored rows are not.
--
-- 00121 repairs the subset whose address still proves the truth. This
-- migration handles the rest, and it is the one place where the stored
-- COORDINATES are used as the arbiter — they came from the feed's own
-- geometry, never from our parsing, so they are the most trustworthy column
-- on the row.
--
-- ─── Why a batched FUNCTION and not one UPDATE ──────────────────────────
-- Same reason as 00120, the reference implementation for this shape: bulk
-- UPDATEs on `permits` exhausted the connection pool, PostgREST began
-- returning PGRST002, and the data layer was unavailable for ~10 minutes.
-- Every PostgREST call inherits the `authenticator` role's 8s
-- statement_timeout, so this does ONE bounded batch per call and returns
-- how many rows it fixed. The caller loops.
--
-- ─── What counts as proof, and what we refuse to guess ──────────────────
-- Detection uses a per-state bounding box with a deliberately generous
-- half-degree margin. Boxes overlap heavily, so "outside this state's box"
-- is a reliable NEGATIVE signal (these coordinates cannot be in the stored
-- state) while "inside some box" is NOT a positive one — a point in the
-- Ohio/Indiana border region is inside both. So the box never chooses the
-- new state; it only vetoes.
--
-- The new state comes from evidence, in order:
--   1. an explicit ", ST 12345" token in the address — written by the
--      jurisdiction, not inferred by us;
--   2. the state declared in `permit_sources`, but ONLY when every source
--      registered under that `source_city` agrees on it. Disagreement means
--      we cannot attribute the row, so we do not.
-- and the candidate is then discarded unless the coordinates fall inside
-- the NEW state's box. A row we cannot prove is left exactly as it is —
-- trading one wrong state for a differently wrong one is worse than doing
-- nothing, because `state` feeds territory matching.
--
-- Rows the function cannot fix stay flagged by the index and are listed by
-- the leftovers query below; several of them are simply bad geocodes
-- upstream, which is a source problem, not a repair problem.
--
-- ─── scored_at ─────────────────────────────────────────────────────────
-- Same rule as 00121/00122. `state` is half of territory matching, so a row
-- that changes state genuinely needs re-scoring — but the score cron's lead
-- upsert hardcodes `status: 'new'` and overwrites `notes`, so re-scoring a
-- permit that already has a lead would revert a contractor's contacted/won
-- work. Only lead-free permits are re-queued. Lead-bearing permits get the
-- corrected `state` column and keep their `scored_at`; those are leads
-- currently sitting in a territory that does not own the property, which is
-- a wedge decision (release the lock? notify? credit the month?) and not
-- something this function may make silently. Run the pre-flight query below
-- BEFORE the repair to capture that list.
--
-- ─── Operator runbook ───────────────────────────────────────────────────
--   -- 0. PRE-FLIGHT (run first, keep the output): live leads on a permit
--   --    whose coordinates contradict its stored state.
--   select l.id as lead_id, l.contractor_id, l.status,
--          p.id as permit_id, p.state as stored_state, p.zip,
--          p.latitude, p.longitude, p.address
--     from public.leads l
--     join public.permits p on p.id = l.permit_id
--    where p.latitude is not null and p.longitude is not null
--      and not public.henri_state_bbox_ok(p.state, p.latitude, p.longitude);
--
--   -- 1. repair, one batch at a time, from the app (service-role client):
--   select public.repair_state_coordinate_mismatch(2000);
--   -- repeat until it returns 0, then:
--
--   -- 2. LEFTOVERS: flagged rows the evidence could not resolve. Expect a
--   --    tail here; it is upstream geocoding noise, not a bug in the loop.
--   select state, count(*) from public.permits p
--    where p.latitude is not null and p.longitude is not null
--      and not public.henri_state_bbox_ok(p.state, p.latitude, p.longitude)
--    group by 1 order by 2 desc;
--
--   drop index if exists public.idx_permits_state_geo_repair;
--   -- 3. refresh the marketing cache so per-state coverage is honest:
--   GET /api/cron/refresh-landing-stats
--
-- BUILD COST: the partial index evaluates a function per row over the whole
-- table, and a plain CREATE INDEX blocks writes to `permits` while it
-- builds. Run this migration from psql or the Management API, not through
-- PostgREST. With the ingest crons live, build it by hand first with
--   CREATE INDEX CONCURRENTLY idx_permits_state_geo_repair ...
-- and the IF NOT EXISTS below becomes a no-op.
--
-- MAINTENANCE: the index predicate calls henri_state_bbox_ok. If you ever
-- CREATE OR REPLACE that function, DROP the index first — Postgres will not
-- notice the definition changed and the index would silently go stale.

-- ── Helper: per-state bounding box ──────────────────────────────────────
--
-- Returns TRUE whenever the point is plausible for the state AND whenever
-- we cannot judge (NULL state, NULL coordinates, a state code not in the
-- table). Only a provable contradiction returns FALSE, so the index below
-- flags nothing it cannot defend.
--
-- Boxes are the states' extents padded by ~0.5 degrees on every side
-- (~35 miles). The padding is intentional: a false positive here rewrites
-- a correct row, while a false negative just leaves a bad row for the next
-- pass. Overlapping boxes are fine because this function only ever vetoes;
-- it never selects a state (see the header).
CREATE OR REPLACE FUNCTION public.henri_state_bbox_ok(
  p_state text,
  p_lat   double precision,
  p_lng   double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_state IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN TRUE
    -- A 0/0 pair is the classic "geocoder returned nothing" sentinel, not
    -- a location in the Gulf of Guinea. Not judgeable.
    WHEN p_lat = 0 AND p_lng = 0 THEN TRUE
    ELSE COALESCE(
      (SELECT p_lat BETWEEN b.lat_min AND b.lat_max
          AND p_lng BETWEEN b.lng_min AND b.lng_max
         FROM (VALUES
           ('AL', 29.7,  35.5, -88.9, -84.4),
           ('AK', 50.6,  71.9,-180.0,-129.5),
           ('AZ', 30.9,  37.5,-115.3,-108.5),
           ('AR', 32.5,  36.9, -94.9, -89.1),
           ('CA', 32.0,  42.5,-124.9,-113.6),
           ('CO', 36.5,  41.5,-109.6,-101.5),
           ('CT', 40.5,  42.6, -73.9, -71.3),
           ('DE', 38.0,  40.3, -76.0, -74.5),
           ('DC', 38.3,  39.5, -77.6, -76.4),
           ('FL', 24.0,  31.5, -87.9, -79.5),
           ('GA', 30.0,  35.5, -85.9, -80.3),
           ('HI', 18.4,  22.7,-160.7,-154.3),
           ('ID', 41.5,  49.5,-117.7,-110.5),
           ('IL', 36.5,  43.0, -91.9, -87.0),
           ('IN', 37.3,  42.0, -88.6, -84.3),
           ('IA', 40.0,  43.9, -96.9, -89.6),
           ('KS', 36.5,  40.5,-102.6, -94.1),
           ('KY', 36.0,  39.6, -89.9, -81.5),
           ('LA', 28.4,  33.5, -94.5, -88.3),
           ('ME', 42.5,  47.9, -71.6, -66.5),
           ('MD', 37.4,  40.2, -79.8, -74.5),
           ('MA', 41.0,  43.4, -73.9, -69.4),
           ('MI', 41.2,  48.8, -90.9, -81.6),
           ('MN', 43.0,  49.9, -97.7, -89.0),
           ('MS', 29.5,  35.5, -91.9, -87.6),
           ('MO', 35.5,  41.1, -95.9, -88.6),
           ('MT', 44.4,  49.5,-116.6,-103.5),
           ('NE', 39.5,  43.5,-104.6, -95.0),
           ('NV', 34.5,  42.5,-120.5,-113.5),
           ('NH', 42.2,  45.8, -72.9, -70.2),
           ('NJ', 38.4,  41.9, -75.9, -73.4),
           ('NM', 31.2,  37.5,-109.6,-102.5),
           ('NY', 40.0,  45.5, -80.3, -71.4),
           ('NC', 33.3,  37.1, -84.8, -75.0),
           ('ND', 45.4,  49.5,-104.6, -96.0),
           ('OH', 38.1,  42.4, -85.3, -80.0),
           ('OK', 33.1,  37.5,-103.5, -94.0),
           ('OR', 41.5,  46.8,-124.9,-116.0),
           ('PA', 39.2,  42.8, -80.9, -74.2),
           ('RI', 40.6,  42.5, -72.4, -70.6),
           ('SC', 31.6,  35.7, -83.9, -78.0),
           ('SD', 42.4,  46.5,-104.6, -96.0),
           ('TN', 34.5,  36.9, -90.8, -81.1),
           ('TX', 25.3,  36.9,-107.1, -93.0),
           ('UT', 36.5,  42.5,-114.6,-108.5),
           ('VT', 42.2,  45.5, -73.9, -70.9),
           ('VA', 36.0,  39.9, -83.9, -75.1),
           ('WA', 45.0,  49.5,-125.0,-116.4),
           ('WV', 36.9,  40.9, -82.9, -77.2),
           ('WI', 42.0,  47.4, -93.4, -86.3),
           ('WY', 40.5,  45.5,-111.6,-103.5)
         ) AS b(code, lat_min, lat_max, lng_min, lng_max)
        WHERE b.code = upper(p_state)),
      -- Unknown code ('US', a blank, a full state name): not judgeable.
      TRUE)
  END
$$;

COMMENT ON FUNCTION public.henri_state_bbox_ok(text, double precision, double precision) IS
  'TRUE when the point is plausible for the state OR when the row cannot be '
  'judged (null state/coords, unknown code). FALSE only on a provable '
  'contradiction. Boxes are padded ~0.5 deg and overlap, so this is a veto '
  'signal only — never use it to CHOOSE a state. See 00126.';

-- Executed with the calling role's privileges during INSERT/UPDATE index
-- maintenance, so it must stay executable by anything that writes to
-- `permits`. It reads no data.
GRANT EXECUTE ON FUNCTION
  public.henri_state_bbox_ok(text, double precision, double precision) TO PUBLIC;

-- ── Repair index ────────────────────────────────────────────────────────
-- See BUILD COST in the header before running this.
CREATE INDEX IF NOT EXISTS idx_permits_state_geo_repair
  ON public.permits (id)
  WHERE latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND NOT public.henri_state_bbox_ok(state, latitude, longitude);

CREATE OR REPLACE FUNCTION public.repair_state_coordinate_mismatch(
  p_batch int DEFAULT 2000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN p_batch := 2000; END IF;
  IF p_batch > 5000 THEN p_batch := 5000; END IF;

  WITH src AS (
    -- One unanimous declared state per source_city, or nothing. `source_city`
    -- is stamped from city with a jurisdiction fallback (sources-db.ts), so
    -- the key is built the same way here. Several feeds can share a city; if
    -- they disagree on the state, the row is not attributable.
    SELECT COALESCE(NULLIF(btrim(ps.city), ''), btrim(ps.jurisdiction)) AS source_city,
           min(upper(ps.state))                                        AS declared_state
      FROM public.permit_sources ps
     WHERE ps.state IS NOT NULL
       AND upper(ps.state) <> 'US'
       AND length(btrim(ps.state)) = 2
       AND COALESCE(NULLIF(btrim(ps.city), ''), btrim(ps.jurisdiction)) IS NOT NULL
     GROUP BY 1
    HAVING count(DISTINCT upper(ps.state)) = 1
  ), cand AS (
    -- Every condition sits BEFORE the LIMIT so the batch is filled only
    -- with rows that will actually change. Otherwise the unresolvable tail
    -- (bad upstream geocodes) would fill each batch, the function would
    -- return 0, and the operator's loop would stop with work remaining.
    SELECT p.id,
           COALESCE(
             public.henri_state_from_address(p.address),
             s.declared_state
           ) AS new_state
      FROM public.permits p
      LEFT JOIN src s ON s.source_city = p.source_city
     WHERE p.latitude IS NOT NULL
       AND p.longitude IS NOT NULL
       AND NOT public.henri_state_bbox_ok(p.state, p.latitude, p.longitude)
       AND COALESCE(public.henri_state_from_address(p.address), s.declared_state)
             IS NOT NULL
       AND COALESCE(public.henri_state_from_address(p.address), s.declared_state)
             IS DISTINCT FROM p.state
       -- The box vetoes the replacement too: never trade one wrong state
       -- for another.
       AND public.henri_state_bbox_ok(
             COALESCE(public.henri_state_from_address(p.address), s.declared_state),
             p.latitude, p.longitude)
     LIMIT p_batch
  ), upd AS (
    UPDATE public.permits p SET
      state = cand.new_state,
      -- See the scored_at section in the header.
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

COMMENT ON FUNCTION public.repair_state_coordinate_mismatch(int) IS
  'Repairs one bounded batch of permits whose stored state contradicts '
  'their own coordinates, re-attributing from the address token or the '
  'unanimous source-declared state and re-checking the result against the '
  'state box. Leaves unprovable rows untouched. Re-queues for scoring ONLY '
  'permits with no lead. Returns rows repaired; call in a loop until it '
  'returns 0. See 00126 for the runbook.';

REVOKE EXECUTE ON FUNCTION public.repair_state_coordinate_mismatch(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repair_state_coordinate_mismatch(int) TO service_role;
