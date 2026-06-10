-- ─────────────────────────────────────────────────────────────────────
-- 00110 · contact_views — pure analytics log of contact-info views.
--
-- Logs every time a contractor views a lead's contact info (phone / email /
-- owner). PURE ANALYTICS — no user-facing counter, no gating, no credit
-- system, no reveal UI. Feeds the "historical conversion" score signal later
-- and provides real COGS-per-territory data.
--
-- Follows the established Henri RLS pattern (see 00061 leads_select_own +
-- 00090 saved_leads): contractor_id uuid REFERENCES profiles(id), RLS enabled,
-- self-policy on (contractor_id = auth.uid()).
--
-- Idempotent + additive.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_views_contractor_idx
  ON public.contact_views (contractor_id, viewed_at);

CREATE INDEX IF NOT EXISTS contact_views_lead_idx
  ON public.contact_views (lead_id);

ALTER TABLE public.contact_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_views_self_select ON public.contact_views;
CREATE POLICY contact_views_self_select ON public.contact_views
  FOR SELECT USING (contractor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS contact_views_self_insert ON public.contact_views;
CREATE POLICY contact_views_self_insert ON public.contact_views
  FOR INSERT WITH CHECK (contractor_id = (SELECT auth.uid()));

COMMIT;
