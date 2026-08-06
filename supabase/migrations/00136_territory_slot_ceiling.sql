-- 00136_territory_slot_ceiling.sql
-- 2026-08-06 — raise the slot_number CHECK to match 00135's per-trade model.
--
-- ─── Why ────────────────────────────────────────────────────────────────
-- 00135 changed territory exclusivity from "3 slots per ZIP, trade ignored"
-- to "one contractor per trade per ZIP", and raised the slot ALLOCATOR from
-- 1..3 to 1..10 (one per value of `trade_type`) so the slot could never be
-- the binding limit.
--
-- It missed the table constraint:
--
--     CHECK ((slot_number >= 1) AND (slot_number <= 3))
--
-- So the allocator would hand out slot 4 and the INSERT would fail with a
-- check violation. Caught by the 00135 verification pass, which tried a
-- direct INSERT at slot 9 and got `violates check constraint` instead of the
-- expected unique violation — the constraint was firing first.
--
-- The failure is real but narrow: it needs a FOURTH distinct trade in one
-- ZIP. With 10 active territories in one metro, all 'general', nothing has
-- hit it — and it would have presented as a contractor being told their ZIP
-- was unavailable for no visible reason.
--
-- ─── Why 10 ─────────────────────────────────────────────────────────────
-- `trade_type` has exactly 10 values (general, roofing, plumbing, electrical,
-- hvac, solar, landscaping, painting, concrete, other), and 00135's unique
-- index on (zip, trade) WHERE status='active' already caps a ZIP at one
-- active territory per trade. So 10 is the true maximum and the CHECK stays a
-- real guard against a bad slot rather than a limit on the product.
--
-- Idempotent: drops the old constraint by name before adding the new one.
-- Rollback at the bottom.

BEGIN;

ALTER TABLE public.territories
  DROP CONSTRAINT IF EXISTS territories_slot_number_check;

ALTER TABLE public.territories
  ADD CONSTRAINT territories_slot_number_check
  CHECK (slot_number >= 1 AND slot_number <= 10);

COMMENT ON COLUMN public.territories.slot_number IS
  'Internal allocation index, 1-10. NOT the exclusivity rule: that is the unique index on (zip, trade) WHERE status=active, added in 00135. Kept because it is NOT NULL and predates the per-trade model. Ceiling raised 3 -> 10 in 00136 to match the 10 values of trade_type.';

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────
-- Only safe while every ZIP has at most 3 active territories.
--   ALTER TABLE public.territories DROP CONSTRAINT IF EXISTS territories_slot_number_check;
--   ALTER TABLE public.territories ADD CONSTRAINT territories_slot_number_check
--     CHECK (slot_number >= 1 AND slot_number <= 3);
