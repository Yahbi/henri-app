-- ─────────────────────────────────────────────────────────────────────
-- 00103 · God-mode RLS lane for leads.
--
-- Problem (2026-06-10 audit): the app-layer god-mode bypass in useLeads
-- skips the `.eq(contractor_id, user.id)` filter, but Postgres RLS
-- (`leads_select_own`, auth.uid() = contractor_id) still hides every
-- row the admin doesn't own. The founder owns ~0 leads, so the admin
-- dashboard/map rendered empty while 270k leads exist.
--
-- Fix: an ADDITIONAL permissive SELECT policy (policies OR together)
-- that grants read on all leads to emails in `god_mode_emails`.
--
-- Design notes:
--   - The check goes through a SECURITY DEFINER function because the
--     policy expression runs as the querying user, and the allowlist
--     table itself is RLS-locked (no leaking admin emails to every
--     authenticated user).
--   - The policy wraps the call in (SELECT ...) so the planner
--     evaluates it ONCE per query (InitPlan), not per row — same
--     pattern as the 00061 initplan perf pass.
--   - Mirrors src/lib/auth/god-mode.ts; keep both lists in sync.
--     Extend by INSERTing a row — no redeploy needed.
--
-- Idempotent. Additive only.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.god_mode_emails (
  email      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.god_mode_emails ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only management; readable inside the
-- SECURITY DEFINER check below.
REVOKE ALL ON public.god_mode_emails FROM PUBLIC, anon, authenticated;

INSERT INTO public.god_mode_emails (email, note) VALUES
  ('y.abismuth@gmail.com',      'founder'),
  ('dev-contractor@henri.local','dev preview account')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_god_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.god_mode_emails g
    WHERE lower(g.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_god_mode() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_god_mode() TO authenticated;

DROP POLICY IF EXISTS "leads_select_godmode" ON public.leads;
CREATE POLICY "leads_select_godmode" ON public.leads
  FOR SELECT TO authenticated
  USING ((SELECT public.is_god_mode()));

COMMIT;
