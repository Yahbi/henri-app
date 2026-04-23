-- 00008_ziplock_rpc.sql
-- RPC functions for atomic ZIP territory operations
-- claim_territory: grab the next open slot (max 3 per ZIP)
-- release_territory: release a slot and auto-promote the first waitlister
-- get_zip_availability: return current slot and waitlist status as JSON

BEGIN;

-- -------------------------------------------------------
-- 1. claim_territory(p_zip, p_contractor_id)
--    Atomically claims the next available slot (1-3).
--    Returns the assigned slot_number.
--    Raises an exception if all 3 slots are taken.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_territory(
  p_zip           varchar(5),
  p_contractor_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot int;
  v_existing int;
BEGIN
  -- Prevent duplicate active claims by the same contractor in this ZIP
  SELECT slot_number INTO v_existing
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  IF FOUND THEN
    RAISE EXCEPTION 'Contractor already holds an active territory in ZIP %', p_zip;
  END IF;

  -- Find the lowest available slot (1, 2, or 3)
  SELECT s.n INTO v_slot
    FROM (VALUES (1),(2),(3)) AS s(n)
   WHERE NOT EXISTS (
     SELECT 1 FROM territories
      WHERE zip = p_zip
        AND slot_number = s.n
        AND status = 'active'
   )
   ORDER BY s.n
   LIMIT 1
   FOR UPDATE;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'All 3 slots are taken for ZIP %', p_zip;
  END IF;

  INSERT INTO territories (zip, contractor_id, status, slot_number, claimed_at)
  VALUES (p_zip, p_contractor_id, 'active', v_slot, now());

  -- Remove from waitlist if they were waiting
  DELETE FROM zip_waitlist
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id;

  RETURN v_slot;
END;
$$;

-- -------------------------------------------------------
-- 2. release_territory(p_zip, p_contractor_id)
--    Releases the contractor's active slot and promotes
--    the first person on the waitlist into that slot.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION release_territory(
  p_zip           varchar(5),
  p_contractor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot          int;
  v_next_id       uuid;
  v_next_wl_id    uuid;
BEGIN
  -- Find and lock the active territory row
  SELECT slot_number INTO v_slot
    FROM territories
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active territory found for contractor in ZIP %', p_zip;
  END IF;

  -- Mark the territory as released
  UPDATE territories
     SET status = 'released',
         released_at = now()
   WHERE zip = p_zip
     AND contractor_id = p_contractor_id
     AND status = 'active';

  -- Check for a waitlisted contractor (first in line)
  SELECT id, contractor_id INTO v_next_wl_id, v_next_id
    FROM zip_waitlist
   WHERE zip = p_zip
   ORDER BY position ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    -- Promote the waitlister into the freed slot
    INSERT INTO territories (zip, contractor_id, status, slot_number, claimed_at)
    VALUES (p_zip, v_next_id, 'active', v_slot, now());

    -- Remove the promoted contractor from the waitlist
    DELETE FROM zip_waitlist WHERE id = v_next_wl_id;

    -- Re-sequence remaining waitlist positions
    WITH renumbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS new_pos
        FROM zip_waitlist
       WHERE zip = p_zip
    )
    UPDATE zip_waitlist w
       SET position = r.new_pos
      FROM renumbered r
     WHERE w.id = r.id;

    -- Notify the promoted contractor
    INSERT INTO notifications (user_id, type, title, body, metadata)
    VALUES (
      v_next_id,
      'territory_available',
      'Territory claimed!',
      'You have been promoted from the waitlist for ZIP ' || p_zip,
      jsonb_build_object('zip', p_zip, 'slot_number', v_slot)
    );
  END IF;
END;
$$;

-- -------------------------------------------------------
-- 3. get_zip_availability(p_zip)
--    Returns JSON with current slot usage, contractor list,
--    and waitlist count for a given ZIP code.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_zip_availability(
  p_zip varchar(5)
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'zip',          p_zip,
    'slots_used',   COALESCE(active.cnt, 0),
    'slots_total',  3,
    'contractors',  COALESCE(active.contractors, '[]'::jsonb),
    'waitlist_count', COALESCE(wl.cnt, 0)
  ) INTO v_result
  FROM
    (SELECT 1) AS dummy
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS cnt,
      jsonb_agg(
        jsonb_build_object(
          'contractor_id', t.contractor_id,
          'slot_number',   t.slot_number,
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
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION claim_territory(varchar, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION release_territory(varchar, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_zip_availability(varchar) TO authenticated;

COMMIT;
