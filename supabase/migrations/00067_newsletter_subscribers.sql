-- 00067_newsletter_subscribers.sql
-- Email-capture inbox for the marketing footer + portal funnel.
-- Backs the /api/newsletter route (graceful-degrade pattern: DB →
-- JSONL → optional Resend ack). Service-role-only; no PostgREST
-- read path because the data isn't user-facing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  source        text,        -- "footer", "portal-hero", etc.
  user_agent    text,
  unsubscribed  boolean NOT NULL DEFAULT false,
  unsubscribed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Lookups by email (idempotent upsert). UNIQUE constraint already
-- creates this index; explicit name kept for clarity in pg_indexes.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_idx
  ON public.newsletter_subscribers (lower(email));

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- No anon / authenticated policies — service-role only writes
-- (cron + /api/newsletter via createAdminClient). RLS-enabled-no-policy
-- is intentional and matches the `voter_*` / `ppp_loans` pattern
-- already documented in CLAUDE.md.

CREATE TRIGGER set_newsletter_subscribers_updated_at
  BEFORE UPDATE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate          (preferred)
--   OR paste into the Supabase SQL editor.
--
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'newsletter_subscribers';
-- Should return 8 rows.
