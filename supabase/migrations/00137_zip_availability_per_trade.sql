-- 00137_zip_availability_per_trade.sql
-- 2026-08-06 — teach ZIP availability about trades (completes 00135).
--
-- ─── Why ────────────────────────────────────────────────────────────────
-- 00135 made exclusivity per (zip, trade). `get_zip_availability` still
-- answered the old question: it hardcoded `slots_total: 3` and counted active
-- territories regardless of trade. So the /portal widget and the onboarding
-- territory map would tell a roofer that a ZIP was "2 of 3 taken — available"
-- when the one roofing slot was already gone, and the claim would then fail
-- at the RPC. Worse in the other direction: a ZIP held by three different
-- trades read as FULL to a fourth trade that could legitimately claim it.
--
-- ─── Backward compatibility ─────────────────────────────────────────────
-- Callers read `slots_used` / `slots_total` (the client derives availability
-- as `slots_used < slots_total`; note it must NOT go back to reading
-- `is_claimed`, which this function has never returned — that bug made every
-- ZIP display as Available and left the Taken badge unreachable).
--
-- Both keys are kept and stay meaningful under the new model:
--   slots_total -> 10, the number of `trade_type` values, i.e. the real
--                  maximum number of contractors a ZIP can hold.
--   slots_used  -> active territories in the ZIP, which under 00135's unique
--                  index is exactly the number of trades taken.
-- So an untouched caller keeps working and simply becomes correct.
--
-- New keys:
--   taken_trades         -> which trades are gone, so the UI can say WHY.
--   available_for_trade  -> null when no trade was supplied; otherwise the
--                           direct answer to "can THIS contractor claim it".
--
-- The old 1-arg function is dropped and replaced by a 2-arg form with a
-- DEFAULT, rather than adding an overload: two candidates would make a 1-arg
-- PostgREST call ambiguous. Existing 1-arg callers bind to the default.
--
-- `contractors` deliberately keeps only contractor_id / slot_number /
-- claimed_at and now trade. It does NOT gain names — the wedge contract keeps
-- competitive intel coarse and never identifies a holder.
--
-- Idempotent. Rollback at the bottom.

BEGIN;

DROP FUNCTION IF EXISTS public.get_zip_availability(character varying);
DROP FUNCTION IF EXISTS public.get_zip_availability(character varying, public.trade_type);

CREATE FUNCTION public.get_zip_availability(
  p_zip   character varying,
  p_trade public.trade_type DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'zip',            p_zip,
    -- Active territories in this ZIP. Under 00135's unique index on
    -- (zip, trade) WHERE status='active', this is also the trade count.
    'slots_used',     COALESCE(active.cnt, 0),
    -- 10 = number of trade_type values = the real ceiling for one ZIP.
    'slots_total',    10,
    'taken_trades',   COALESCE(active.trades, '[]'::jsonb),
    'available_for_trade',
      CASE
        WHEN p_trade IS NULL THEN NULL
        ELSE NOT EXISTS (
          SELECT 1 FROM territories t2
           WHERE t2.zip = p_zip
             AND t2.trade = p_trade
             AND t2.status = 'active'
        )
      END,
    'contractors',    COALESCE(active.contractors, '[]'::jsonb),
    'waitlist_count', COALESCE(wl.cnt, 0)
  ) INTO v_result
  FROM
    (SELECT 1) AS dummy
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS cnt,
      jsonb_agg(DISTINCT t.trade::text) AS trades,
      jsonb_agg(
        jsonb_build_object(
          'contractor_id', t.contractor_id,
          'slot_number',   t.slot_number,
          'trade',         t.trade,
          'claimed_at',    t.claimed_at
        ) ORDER BY t.slot_number
      ) AS contractors
    FROM territories t
    WHERE t.zip = p_zip AND t.status = 'active'
  ) active ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM zip_waitlist
    WHERE zip = p_zip
  ) wl ON true;

  RETURN v_result;
END;
$function$;

-- Anon EXECUTE is intentional and pre-existing: the public ZIP-availability
-- widget on /portal is unauthenticated. The function returns no contractor
-- names or contact details, so it discloses only what the marketing page
-- already states.
REVOKE EXECUTE ON FUNCTION public.get_zip_availability(character varying, public.trade_type) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_zip_availability(character varying, public.trade_type) TO anon, authenticated, service_role;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.get_zip_availability(character varying, public.trade_type);
--   -- then re-apply the 1-arg body from the migration that last defined it.
