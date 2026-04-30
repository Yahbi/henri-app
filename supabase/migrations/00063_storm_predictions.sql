-- 00063_storm_predictions.sql
-- Tier A+ Sprint 1 — F2.1 storm-damage opportunity prediction.
--
-- Caches per-lead storm-impact predictions. Given a lead's ZIP, looks up
-- recent storm events (NOAA via storm_events table) and produces a
-- repair-likelihood score: how likely is this property to need
-- roofing/siding/window repair work in the next 60-90 days based on
-- post-storm permit-pull patterns?
--
-- Refreshed weekly by /api/cron/predictive-refresh (same job as cascade).
--
-- Tier A+ compliance: this table holds NO PII. Aggregates public NOAA
-- storm data + public permit-pull patterns. No homeowner data.
-- RLS: contractor sees predictions for their own leads only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.storm_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  -- Number of NOAA storm events at this lead's ZIP in the last 60 days
  -- (counted at compute time; refreshed weekly).
  storm_event_count_60d integer NOT NULL DEFAULT 0
    CHECK (storm_event_count_60d >= 0),

  -- Most recent storm event date in the lead's ZIP within the 60-day window
  last_storm_date date,

  -- Most severe storm magnitude in the window (NOAA's `magnitude` field —
  -- inches of hail for hail events, mph for wind events). Best-effort.
  max_magnitude numeric(8, 2),

  -- Predominant event type in the window: 'Hail', 'Tornado', 'Thunderstorm Wind',
  -- 'Heavy Rain', 'Flood', 'Wildfire', etc. Free text from NOAA.
  primary_event_type text,

  -- Repair-likelihood prediction within 60 days. Derived from
  -- historical post-storm-permit-pull rates for the trade + ZIP. Range [0.0, 1.0].
  repair_likelihood_60d numeric(4, 3) NOT NULL DEFAULT 0
    CHECK (repair_likelihood_60d >= 0 AND repair_likelihood_60d <= 1),

  -- Same for 90 days
  repair_likelihood_90d numeric(4, 3) NOT NULL DEFAULT 0
    CHECK (repair_likelihood_90d >= 0 AND repair_likelihood_90d <= 1),

  -- Sample size for the prediction (number of historical post-storm
  -- ZIP×trade pairs used). For confidence labeling.
  sample_size integer NOT NULL DEFAULT 0 CHECK (sample_size >= 0),

  confidence_label text NOT NULL DEFAULT 'low'
    CHECK (confidence_label IN ('low', 'medium', 'high')),

  computed_at timestamptz NOT NULL DEFAULT NOW(),

  -- One row per lead. UPSERT on refresh.
  UNIQUE (lead_id)
);

-- Index for dashboard query: lead lookup
CREATE INDEX IF NOT EXISTS storm_predictions_lead_id_idx
  ON public.storm_predictions (lead_id);

-- Index for the "show me storm-impacted leads in last 60d" filter
CREATE INDEX IF NOT EXISTS storm_predictions_storm_count_idx
  ON public.storm_predictions (storm_event_count_60d DESC)
  WHERE storm_event_count_60d > 0;

-- RLS: contractor sees predictions for their own leads
ALTER TABLE public.storm_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storm_predictions_select_own" ON public.storm_predictions;
CREATE POLICY "storm_predictions_select_own" ON public.storm_predictions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = storm_predictions.lead_id
        AND l.contractor_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.storm_predictions IS
  'Cached storm-impact predictions per lead. Refreshed weekly by '
  '/api/cron/predictive-refresh. Tier A+ Sprint 1. NO PII.';

COMMIT;
