-- ─────────────────────────────────────────────────────────────────────
-- 00089 · Homeowner consent + withdraw on `homeowner_intakes`.
--
-- Module 5 of the 18-module enhancement plan (2026-05-09 plan §9.5).
--
-- Adds two columns:
--   consent_given_at      timestamptz — when the homeowner ticked the
--                                       consent checkbox in the chat
--                                       intake modal final step.
--   consent_text_version  text         — version tag of the consent
--                                       text shown ("v1.2026-05-09").
--                                       Lets us prove what they agreed
--                                       to if challenged later.
--
-- Status semantics (existing `status` column extended):
--   'pending'     — intake submitted, awaiting match
--   'matched'     — paired with a contractor
--   'won' / 'lost' — outcome
--   'withdrawn'   — homeowner clicked Withdraw on the dashboard.
--                   Outreach sender refuses contacts on withdrawn
--                   intakes (Module 7).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.homeowner_intakes
  ADD COLUMN IF NOT EXISTS consent_given_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_text_version text;

CREATE INDEX IF NOT EXISTS homeowner_intakes_consent_idx
  ON public.homeowner_intakes (consent_given_at)
  WHERE consent_given_at IS NOT NULL;

COMMENT ON COLUMN public.homeowner_intakes.consent_given_at IS
  '00089 - Module 5. When the homeowner explicitly authorized contractor outreach via the intake modal checkbox.';
COMMENT ON COLUMN public.homeowner_intakes.consent_text_version IS
  '00089 - Module 5. Version tag of the consent text shown to the homeowner. Used as proof-of-version if a homeowner later disputes what they agreed to.';

COMMIT;
