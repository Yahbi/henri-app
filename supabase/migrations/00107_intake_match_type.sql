-- ─────────────────────────────────────────────────────────────────────
-- 00107 · homeowner_intakes.match_type
--
-- 2026-06-10 cold-start matching: when nobody has claimed a homeowner's
-- exact ZIP, the matcher now widens to the nearest contractor within
-- 150 mi (src/lib/matching/engine.ts findProximityMatches). This column
-- records HOW an intake was matched so proximity matches are
-- distinguishable from exact-territory matches in ops + analytics.
--   territory  = a contractor claimed this exact ZIP
--   proximity  = cold-start widen-to-nearest fallback
--   none       = no contractor within range (manual review)
--
-- Additive, idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.homeowner_intakes
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'none';

DO $$ BEGIN
  ALTER TABLE public.homeowner_intakes
    ADD CONSTRAINT homeowner_intakes_match_type_chk
    CHECK (match_type IN ('territory', 'proximity', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
