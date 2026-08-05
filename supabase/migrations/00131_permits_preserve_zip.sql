-- 00131_permits_preserve_zip.sql
-- 2026-08-05 — STOPS THE SCRAPER FROM DESTROYING RESOLVED ZIPs.
--
-- ─── Measured, not theorised ────────────────────────────────────────────
-- One scrape run, isolated and measured either side:
--
--   distinct permits.zip   16,112  ->  15,417   (-695)
--   rows carrying a zip   869,599  ->  887,605  (+18,006)
--
-- More rows have a ZIP, yet 695 distinct ZIP VALUES vanished. That shape
-- only happens one way: existing correct ZIPs are being overwritten with
-- different, wrong ones, collapsing many distinct values into few.
--
-- ─── Why the app-side fix was not enough ────────────────────────────────
-- An earlier fix today stopped the upsert writing `zip: null` over a stored
-- ZIP (the payload always carried the column, and merge-duplicates turned a
-- missing value into SET zip = NULL). That was real and is fixed. This is the
-- second half of the same wound: a wrong NON-NULL value.
--
-- src/lib/scrapers/flat-record.ts resolveZip() returns { zip, trusted }:
--   trusted   — an explicit ZIP column, or the location object
--   UNtrusted — a 5-digit run regex-matched out of the free-text address
--
-- The `trusted` flag is computed and then used ONLY by deriveState(). It has
-- never gated the ZIP write itself, so an untrusted address-scrape overwrites
-- a trusted source-supplied ZIP. `mail_zip` is also in the fallback key list,
-- which is the OWNER'S MAILING ZIP — frequently a PO box or an out-of-state
-- address, not the property being permitted.
--
-- The rate went up sharply today because two other fixes made each run touch
-- ~35 sources instead of ~10 and read each source's NEWEST page. Those changes
-- are correct; they simply exposed how fast this was already bleeding.
--
-- ─── Why the guard belongs in the database ──────────────────────────────
-- The writer is a PostgREST upsert. It cannot express "write this column only
-- if the stored value is NULL" — ON CONFLICT DO UPDATE sets every supplied
-- column unconditionally, and the client cannot see the stored row. The only
-- place that knows both OLD and NEW is a trigger.
--
-- ─── The rule, and its cost ─────────────────────────────────────────────
-- First non-empty ZIP wins. Once a permit has a ZIP, an UPDATE cannot change
-- it.
--
-- The cost is real and accepted: a genuine upstream CORRECTION to a ZIP will
-- also be ignored. That is the right trade. A permit's ZIP does not legitimately
-- change — the building does not move — whereas the measured cost of allowing
-- overwrites is 695 destroyed ZIPs per run, and every destroyed ZIP is a permit
-- that can no longer match a territory and so can no longer become a lead
-- (score/route.ts drops it at `if (!zip) continue`).
--
-- To correct a ZIP deliberately, NULL it first, then write the new value — two
-- statements, which is the appropriate amount of friction for overwriting
-- resolved location data.
--
-- INSERTs are untouched: the trigger is UPDATE-only, so new permits store
-- whatever the source provides.
--
-- /api/cron/census-geocode is untouched: it only targets rows WHERE zip IS
-- NULL, so OLD.zip is NULL and the guard does not fire. Backfill keeps working.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER. Rollback at the bottom.

BEGIN;

CREATE OR REPLACE FUNCTION public.permits_preserve_zip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  /* Only defend a ZIP we already have. NULL -> value is the geocoder's
     backfill lane and must stay open. */
  IF OLD.zip IS NOT NULL AND OLD.zip <> '' AND NEW.zip IS DISTINCT FROM OLD.zip THEN
    NEW.zip := OLD.zip;
  END IF;

  /* Same hazard, same shape: a re-scrape that resolves no coordinates, or
     resolves junk ones from a mis-mapped lat/lng column, must not erase
     coordinates an earlier geocode pass established. Coordinates are only
     ever replaced when the stored pair is incomplete. */
  IF OLD.latitude IS NOT NULL AND OLD.longitude IS NOT NULL
     AND (NEW.latitude IS NULL OR NEW.longitude IS NULL) THEN
    NEW.latitude  := OLD.latitude;
    NEW.longitude := OLD.longitude;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.permits_preserve_zip() IS
  'Keeps the first non-empty permits.zip and any complete coordinate pair. A PostgREST upsert cannot say "only if NULL", and re-scrapes were overwriting resolved ZIPs with address-derived ones (measured: -695 distinct ZIPs in one run). See 00131.';

DROP TRIGGER IF EXISTS permits_preserve_zip ON public.permits;
CREATE TRIGGER permits_preserve_zip
  BEFORE UPDATE ON public.permits
  FOR EACH ROW EXECUTE FUNCTION public.permits_preserve_zip();

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Only once the scraper itself refuses to write an untrusted ZIP over a
-- trusted one (resolveZip already computes the `trusted` flag; it is simply
-- not consulted for the write).
--
--   DROP TRIGGER IF EXISTS permits_preserve_zip ON public.permits;
--   DROP FUNCTION IF EXISTS public.permits_preserve_zip();
