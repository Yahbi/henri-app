-- 00062_cascade_predictions.sql
-- Tier A+ Sprint 1 — F2 cascade prediction.
--
-- Caches per-lead follow-on-permit probability predictions, refreshed weekly
-- by /api/cron/predictive-refresh. The model is deterministic: for a given
-- lead's primary trade + ZIP + permit-cascade-history, what % of similar
-- properties had a follow-on permit of trade X within N days?
--
-- Why a cache table (not a view): predictions involve a self-join on
-- address_permit_history filtered by trade + time window. Per-lead computation
-- is ~50ms; precomputing weekly keeps drawer-render <100ms.
--
-- Confidence levels:
--   - low:    sample_size < 50
--   - medium: 50 <= sample_size < 500
--   - high:   sample_size >= 500
-- The UI hides predictions with sample_size < 10 entirely.
--
-- Tier A+ compliance: this table holds NO PII. predicted_trade is one of
-- Henri's 7 canonical trades. lead_id is the foreign key. No homeowner data.
-- RLS: contractor sees predictions for their own leads only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cascade_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  -- Predicted follow-on trade (one of Henri's 7 canonical trades)
  predicted_trade text NOT NULL CHECK (
    predicted_trade IN (
      'roofing', 'hvac', 'plumbing', 'electrical',
      'solar', 'adu', 'general remodel'
    )
  ),

  -- Probability of follow-on permit of `predicted_trade` within N days.
  -- Range [0.0, 1.0]. Clamped at the application layer too.
  prob_90d numeric(4, 3) NOT NULL CHECK (prob_90d >= 0 AND prob_90d <= 1),
  prob_180d numeric(4, 3) NOT NULL CHECK (prob_180d >= 0 AND prob_180d <= 1),
  prob_365d numeric(4, 3) NOT NULL CHECK (prob_365d >= 0 AND prob_365d <= 1),

  -- Sample size that produced this prediction (for confidence interval)
  sample_size integer NOT NULL CHECK (sample_size >= 0),

  -- Bucketed confidence label, derived from sample_size at compute time
  confidence_label text NOT NULL CHECK (
    confidence_label IN ('low', 'medium', 'high')
  ),

  computed_at timestamptz NOT NULL DEFAULT NOW(),

  -- One prediction per (lead, predicted_trade) pair. UPSERT on refresh.
  UNIQUE (lead_id, predicted_trade)
);

-- Index for the dashboard query: "give me all predictions for this lead
-- ordered by 90-day probability descending."
CREATE INDEX IF NOT EXISTS cascade_predictions_lead_id_prob90_idx
  ON public.cascade_predictions (lead_id, prob_90d DESC);

-- Index for the cron's UPSERT lookup
CREATE INDEX IF NOT EXISTS cascade_predictions_computed_at_idx
  ON public.cascade_predictions (computed_at);

-- RLS: contractor sees predictions for their own leads
ALTER TABLE public.cascade_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cascade_predictions_select_own" ON public.cascade_predictions;
CREATE POLICY "cascade_predictions_select_own" ON public.cascade_predictions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = cascade_predictions.lead_id
        AND l.contractor_id = (SELECT auth.uid())
    )
  );

-- Service-role-only writes (the cron)
DROP POLICY IF EXISTS "cascade_predictions_service_write" ON public.cascade_predictions;
-- No INSERT/UPDATE/DELETE policy → RLS implicitly denies for non-service roles.
-- The cron uses createAdminClient() which bypasses RLS.

COMMENT ON TABLE public.cascade_predictions IS
  'Cached follow-on permit predictions per lead. Refreshed weekly by '
  '/api/cron/predictive-refresh. Tier A+ Sprint 1. NO PII.';

COMMIT;
