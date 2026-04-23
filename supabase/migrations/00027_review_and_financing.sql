-- ────────────────────────────────────────────────────────────────────────
-- 00027: Review responses + financing requests tables
--
-- Supports:
--   - src/app/api/reviews/respond/route.ts    (review_responses)
--   - src/app/api/financing/request/route.ts  (financing_requests)
--
-- Both endpoints already write to these tables; before this migration
-- they returned 501 with "table not yet migrated" hints.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- External review identifier from the source platform (Google, Yelp, etc).
  -- Stored as text because platform IDs vary in format.
  review_id text NOT NULL,
  reply text NOT NULL CHECK (char_length(reply) <= 4000),
  -- Status progression: draft (saved locally) → posted (published to platform)
  -- → failed (platform API rejected).
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'failed')),
  platform text,
  posted_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One reply per (contractor, review). Re-submitting upserts.
  UNIQUE (contractor_id, review_id)
);

CREATE INDEX IF NOT EXISTS idx_review_responses_contractor
  ON public.review_responses (contractor_id, updated_at DESC);

ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;

-- Contractors can only see + write their own review responses.
CREATE POLICY "review_responses_own_rw"
  ON public.review_responses
  FOR ALL
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

-- Service role can do anything (needed by the future posting cron).
CREATE POLICY "review_responses_service_all"
  ON public.review_responses
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


CREATE TABLE IF NOT EXISTS public.financing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  partner text NOT NULL,
  partner_url text,
  homeowner_email text,
  status text NOT NULL DEFAULT 'sent_intent'
    CHECK (status IN ('sent_intent', 'email_delivered', 'applied', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financing_requests_contractor
  ON public.financing_requests (contractor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financing_requests_lead
  ON public.financing_requests (lead_id);

ALTER TABLE public.financing_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financing_requests_own_rw"
  ON public.financing_requests
  FOR ALL
  USING (auth.uid() = contractor_id)
  WITH CHECK (auth.uid() = contractor_id);

CREATE POLICY "financing_requests_service_all"
  ON public.financing_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
