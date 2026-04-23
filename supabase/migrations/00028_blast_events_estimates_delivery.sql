-- ────────────────────────────────────────────────────────────────────────
-- 00028: Blast events table + estimates delivery tracking
--
-- Supports:
--   - src/app/api/cron/blast-worker/route.ts  (blast_events inserts)
--   - src/app/api/estimates/send/route.ts     (estimates.delivered_*)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blast_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.blast_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  delivered boolean NOT NULL DEFAULT false,
  error text,
  provider_message_id text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blast_events_campaign
  ON public.blast_events (campaign_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_blast_events_lead
  ON public.blast_events (lead_id);

ALTER TABLE public.blast_events ENABLE ROW LEVEL SECURITY;

-- Events are service-role-only writes (the cron). Read access gated
-- through the campaign — contractors can only see events on their own
-- campaigns.
CREATE POLICY "blast_events_own_read"
  ON public.blast_events
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.blast_campaigns c
    WHERE c.id = blast_events.campaign_id
      AND c.contractor_id = auth.uid()
  ));

CREATE POLICY "blast_events_service_all"
  ON public.blast_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Estimates delivery columns — recorded by /api/estimates/send when
-- the contractor emails a quote to the homeowner.
ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_to_email text,
  ADD COLUMN IF NOT EXISTS delivered_pdf_url text;

CREATE INDEX IF NOT EXISTS idx_estimates_delivered_at
  ON public.estimates (delivered_at)
  WHERE delivered_at IS NOT NULL;

-- Also add the sent_count / failed_count / sent_at columns referenced
-- by blast-worker but missing from the original blast_campaigns migration.
ALTER TABLE public.blast_campaigns
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;
