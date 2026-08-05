-- 00125_repair_permit_status.sql
--
-- Batched repair for permits whose `status` was mis-derived by the old
-- unanchored substring matcher.
--
-- ─── The damage ─────────────────────────────────────────────────────────
-- `normalizeStatus` used to classify with `lower.includes(kw)`. Two
-- confirmed false friends in live data (~17,000 rows):
--
--   'INACTIVE' -> `approved`   ("inactive".includes("active"))
--   'COMPLETE' -> `submitted`  (the final list carried "completed", and
--                               "complete".includes("completed") is false,
--                               so it fell through to the default)
--
-- This is not cosmetic. `permits.status` drives `opportunity_stage`, so a
-- dead permit was rendered to contractors as live work, and a finished job
-- was rendered as a fresh application.
--
-- The scraper is already fixed (src/lib/scrapers/normalizer.ts: explicit
-- negations, then whole-token matching, then a restricted substring pass).
-- The stored rows are not.
--
-- ─── Why a batched FUNCTION and not one UPDATE ──────────────────────────
-- Same reason as 00120, which is the reference implementation for this
-- shape: bulk UPDATEs on `permits` exhausted the connection pool, PostgREST
-- started returning PGRST002, and the data layer was unavailable for ~10
-- minutes. Every PostgREST call inherits the `authenticator` role's 8s
-- statement_timeout, so this does ONE bounded batch per call and returns
-- how many rows it fixed. The caller loops.
--
-- ─── How a row is proven corrupt (this is the important part) ───────────
-- Re-deriving a status means reading the raw value back out of `raw_json`,
-- and the key that holds it differs per feed (`status`, `status_current`,
-- `statuscurrent`, `permit_status`, `job_status`, ...). `permit_sources`
-- knows the right key per source, but an index predicate cannot contain a
-- subquery, so the extractor here walks a fixed priority list of key names
-- instead. Picking the WRONG key would let this function rewrite a correct
-- status from an unrelated field — much worse than the bug it fixes.
--
-- So a row is only touched when BOTH hold:
--   1. the OLD matcher, replayed against the extracted text, reproduces the
--      value currently stored, and
--   2. the NEW matcher disagrees with it.
--
-- Condition 1 is a provenance proof: it says "this stored value really did
-- come from the old matcher reading THIS text". If the extractor grabbed the
-- wrong key, the replay almost never reproduces the stored value, and the
-- row is skipped. The failure mode is under-repair, never mis-repair.
--
-- `henri_permit_status_legacy` is a deliberate reconstruction of the
-- pre-fix matcher and exists ONLY for that proof. It is not a fallback and
-- nothing else may call it. If the reconstruction is imperfect for some
-- feed, that feed's rows simply go unrepaired; the runbook query below
-- lists what was left behind.
--
-- ─── scored_at ─────────────────────────────────────────────────────────
-- Same rule as 00121, and for the same reason: the score cron's lead upsert
-- hardcodes `status: 'new'` and overwrites `notes`, so re-scoring a permit
-- that already has a lead reverts contractor pipeline state. Only
-- lead-free permits are re-queued. Lead-bearing permits get the corrected
-- `status` column (so the drawer tells the truth) but keep their
-- `scored_at`, and the stage shown on an existing lead is a human decision
-- rather than a silent rewrite.
--
-- ─── Operator runbook ───────────────────────────────────────────────────
--   -- 0. How many rows will this touch, and how are they distributed?
--   select p.status as stored,
--          public.henri_permit_status(
--            public.henri_raw_status_text(p.raw_json)) as corrected,
--          count(*)
--     from public.permits p
--    where p.raw_json is not null
--      and public.henri_permit_status_legacy(
--            public.henri_raw_status_text(p.raw_json)) = p.status
--      and public.henri_permit_status(
--            public.henri_raw_status_text(p.raw_json)) <> p.status
--    group by 1, 2 order by 3 desc;
--
--   -- 1. repair, one batch at a time, from the app (service-role client):
--   select public.repair_permit_status(2000);   -- returns rows repaired
--   -- repeat until it returns 0, then:
--   drop index if exists public.idx_permits_status_repair;
--
-- BUILD COST: the partial index below evaluates two plpgsql functions per
-- row over the whole table. That is a single long statement — run this
-- migration from psql or the Management API, never through PostgREST (8s).
-- A plain CREATE INDEX also blocks writes to `permits` while it builds; if
-- the ingest crons are live, build it by hand first with
--   CREATE INDEX CONCURRENTLY idx_permits_status_repair ...
-- and the IF NOT EXISTS below becomes a no-op.
--
-- MAINTENANCE: the index predicate calls the three helper functions. If you
-- ever CREATE OR REPLACE one of them, DROP the index first — Postgres will
-- not notice the definition changed and the index would silently go stale.

-- ── Helpers ─────────────────────────────────────────────────────────────

-- Whole-token containment against a pre-padded, punctuation-collapsed
-- string. Mirrors the ` ${kw} ` test in normalizeStatus.
CREATE OR REPLACE FUNCTION public.henri_has_token(p_padded text, p_kws text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(p_kws) AS k
     WHERE position(' ' || k || ' ' IN p_padded) > 0
  )
$$;

-- Pull the raw status text out of a scraped record.
--
-- The priority list is ordered most-specific first so a record carrying
-- both `permit_status` and a generic `status` uses the specific one. Key
-- comparison is case-insensitive because feeds differ on casing.
--
-- Returns NULL for a missing/blank value. That NULL is load-bearing: the
-- matchers below return NULL for NULL input, which makes every comparison
-- in the index predicate NULL, which excludes the row. Without it, a record
-- whose status key is not on this list would "normalise" to the default
-- `submitted` and this repair would flatten the whole table.
CREATE OR REPLACE FUNCTION public.henri_raw_status_text(p_raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT e.value
    FROM jsonb_each_text(
           CASE WHEN jsonb_typeof(p_raw) = 'object' THEN p_raw
                ELSE '{}'::jsonb END
         ) AS e(key, value)
    JOIN (VALUES
            ('permit_status',       1),
            ('permitstatus',        2),
            ('status_current',      3),
            ('statuscurrent',       4),
            ('current_status',      5),
            ('currentstatus',       6),
            ('job_status',          7),
            ('jobstatus',           8),
            ('application_status',  9),
            ('applicationstatus',  10),
            ('record_status',      11),
            ('recordstatus',       12),
            ('case_status',        13),
            ('casestatus',         14),
            ('workflow_status',    15),
            ('wf_status',          16),
            ('status_description', 17),
            ('statusdescription',  18),
            ('status_desc',        19),
            ('statusdesc',         20),
            ('status_type',        21),
            ('statustype',         22),
            ('status',             23),
            -- Berkeley's feed calls its status column `statename`. Ranked
            -- last because elsewhere that name means a US state; the
            -- provenance proof in the index predicate rejects those.
            ('statename',          24)
         ) AS k(name, prio) ON lower(e.key) = k.name
   WHERE btrim(COALESCE(e.value, '')) <> ''
   ORDER BY k.prio
   LIMIT 1
$$;

-- SQL port of the CURRENT normalizeStatus(). Keep in sync with
-- src/lib/scrapers/normalizer.ts.
CREATE OR REPLACE FUNCTION public.henri_permit_status(p_raw text)
RETURNS public.permit_status
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_lower  text;
  v_padded text;
BEGIN
  -- See henri_raw_status_text: NULL in, NULL out, row excluded.
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  v_lower := lower(p_raw);

  -- 1. Explicit negations win outright.
  IF v_lower ~ '\yin[-\s]?active\y'  THEN RETURN 'expired'::public.permit_status; END IF;
  IF v_lower ~ '\ynon[-\s]?active\y' THEN RETURN 'expired'::public.permit_status; END IF;
  IF v_lower ~ '\ydisapprov'         THEN RETURN 'revoked'::public.permit_status; END IF;
  IF v_lower ~ '\yun[-\s]?approved\y' THEN RETURN 'revoked'::public.permit_status; END IF;
  IF v_lower ~ '\ynot\s+approved\y'  THEN RETURN 'revoked'::public.permit_status; END IF;

  -- 2. Whole-token match. Collapsing punctuation runs to a single space
  --    lets "APPROVED_2024" and "under-review" match while "inactive"
  --    still cannot match "active".
  v_padded := ' ' || btrim(regexp_replace(v_lower, '[^a-z0-9]+', ' ', 'g')) || ' ';

  IF public.henri_has_token(v_padded, ARRAY['revoked','cancelled','canceled',
       'withdrawn','suspended','denied','rejected','refused','disapproved'])
    THEN RETURN 'revoked'::public.permit_status; END IF;
  IF public.henri_has_token(v_padded, ARRAY['expired','lapsed','void'])
    THEN RETURN 'expired'::public.permit_status; END IF;
  IF public.henri_has_token(v_padded, ARRAY['completed','complete','closed',
       'finalized','done','final'])
    THEN RETURN 'final'::public.permit_status; END IF;
  IF public.henri_has_token(v_padded, ARRAY['issued'])
    THEN RETURN 'issued'::public.permit_status; END IF;
  IF public.henri_has_token(v_padded, ARRAY['approved','granted','active'])
    THEN RETURN 'approved'::public.permit_status; END IF;
  IF public.henri_has_token(v_padded, ARRAY['submitted','filed','received',
       'pending','application','under review','in review','review',
       'plan check','examining'])
    THEN RETURN 'submitted'::public.permit_status; END IF;

  -- 3. Legacy substring pass, restricted to unambiguous keywords, so glued
  --    values ("FINALED", "ISSUEDPERMIT") keep their historical meaning.
  IF v_lower LIKE '%revoke%'    THEN RETURN 'revoked'::public.permit_status;   END IF;
  IF v_lower LIKE '%cancel%'    THEN RETURN 'revoked'::public.permit_status;   END IF;
  IF v_lower LIKE '%withdraw%'  THEN RETURN 'revoked'::public.permit_status;   END IF;
  IF v_lower LIKE '%reject%'    THEN RETURN 'revoked'::public.permit_status;   END IF;
  IF v_lower LIKE '%denied%'    THEN RETURN 'revoked'::public.permit_status;   END IF;
  IF v_lower LIKE '%expire%'    THEN RETURN 'expired'::public.permit_status;   END IF;
  IF v_lower LIKE '%lapsed%'    THEN RETURN 'expired'::public.permit_status;   END IF;
  IF v_lower LIKE '%finaled%'   THEN RETURN 'final'::public.permit_status;     END IF;
  IF v_lower LIKE '%finalized%' THEN RETURN 'final'::public.permit_status;     END IF;
  IF v_lower LIKE '%completed%' THEN RETURN 'final'::public.permit_status;     END IF;
  IF v_lower LIKE '%issued%'    THEN RETURN 'issued'::public.permit_status;    END IF;
  IF v_lower LIKE '%submitted%' THEN RETURN 'submitted'::public.permit_status; END IF;
  IF v_lower LIKE '%pending%'   THEN RETURN 'submitted'::public.permit_status; END IF;

  RETURN 'submitted'::public.permit_status;
END;
$$;

COMMENT ON FUNCTION public.henri_permit_status(text) IS
  'SQL port of normalizeStatus() in src/lib/scrapers/normalizer.ts, except '
  'that NULL/blank input returns NULL instead of the ''submitted'' default. '
  'Keep the two in sync.';

-- Reconstruction of the PRE-FIX matcher: unanchored `includes`, no
-- negations, no restricted substring pass, and a `final` list that carried
-- "completed" but not "complete".
--
-- This exists solely to prove that a stored status came from the old code
-- reading a specific raw string (see the header). Do not call it from
-- anywhere else, and do not "improve" it — its only correctness criterion
-- is fidelity to the bug.
CREATE OR REPLACE FUNCTION public.henri_permit_status_legacy(p_raw text)
RETURNS public.permit_status
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_lower text;
  k       text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  v_lower := lower(p_raw);

  FOREACH k IN ARRAY ARRAY['revoked','cancelled','canceled','withdrawn',
      'suspended','denied','rejected','refused','disapproved'] LOOP
    IF position(k IN v_lower) > 0 THEN RETURN 'revoked'::public.permit_status; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['expired','lapsed','void'] LOOP
    IF position(k IN v_lower) > 0 THEN RETURN 'expired'::public.permit_status; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['completed','closed','finalized','done','final'] LOOP
    IF position(k IN v_lower) > 0 THEN RETURN 'final'::public.permit_status; END IF;
  END LOOP;
  IF position('issued' IN v_lower) > 0 THEN RETURN 'issued'::public.permit_status; END IF;
  FOREACH k IN ARRAY ARRAY['approved','granted','active'] LOOP
    IF position(k IN v_lower) > 0 THEN RETURN 'approved'::public.permit_status; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['submitted','filed','received','pending',
      'application','under review','in review','review','plan check',
      'examining'] LOOP
    IF position(k IN v_lower) > 0 THEN RETURN 'submitted'::public.permit_status; END IF;
  END LOOP;

  RETURN 'submitted'::public.permit_status;
END;
$$;

COMMENT ON FUNCTION public.henri_permit_status_legacy(text) IS
  'Reconstruction of the pre-fix substring status matcher. Used ONLY to '
  'prove provenance of a stored status in 00125. Never call it as a '
  'fallback.';

-- Index-predicate functions are executed with the calling role's privileges
-- during INSERT/UPDATE, so they must stay executable by anything that
-- writes to `permits`. They read no data and leak nothing.
GRANT EXECUTE ON FUNCTION public.henri_has_token(text, text[])       TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.henri_raw_status_text(jsonb)        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.henri_permit_status(text)           TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.henri_permit_status_legacy(text)    TO PUBLIC;

-- ── Repair index ────────────────────────────────────────────────────────
-- See BUILD COST in the header before running this.
CREATE INDEX IF NOT EXISTS idx_permits_status_repair
  ON public.permits (id)
  WHERE raw_json IS NOT NULL
    AND public.henri_permit_status_legacy(
          public.henri_raw_status_text(raw_json)) = status
    AND public.henri_permit_status(
          public.henri_raw_status_text(raw_json)) <> status;

CREATE OR REPLACE FUNCTION public.repair_permit_status(p_batch int DEFAULT 2000)
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

  WITH cand AS (
    -- Predicate is character-for-character the index predicate, so every
    -- candidate is guaranteed to change status and therefore to leave the
    -- index. That is what makes "loop until it returns 0" terminate.
    SELECT p.id,
           public.henri_permit_status(
             public.henri_raw_status_text(p.raw_json)) AS new_status
      FROM public.permits p
     WHERE p.raw_json IS NOT NULL
       AND public.henri_permit_status_legacy(
             public.henri_raw_status_text(p.raw_json)) = p.status
       AND public.henri_permit_status(
             public.henri_raw_status_text(p.raw_json)) <> p.status
     LIMIT p_batch
  ), upd AS (
    UPDATE public.permits p SET
      status = cand.new_status,
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

COMMENT ON FUNCTION public.repair_permit_status(int) IS
  'Repairs one bounded batch of permits whose status came from the pre-fix '
  'substring matcher, re-deriving it from raw_json with the corrected '
  'normalizer. Only touches rows where the legacy matcher provably produced '
  'the stored value. Re-queues for scoring ONLY permits with no lead. '
  'Returns rows repaired; call in a loop until it returns 0. See 00125.';

REVOKE EXECUTE ON FUNCTION public.repair_permit_status(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.repair_permit_status(int) TO service_role;
