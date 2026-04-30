-- 00064_permit_anomalies.sql
-- Tier A+ Sprint 1 — F2.5 permit-aging anomaly detection.
--
-- Flags permits where the gap between applied_date and issued_date is
-- unusually long for the issuing jurisdiction (suggests stuck application).
-- Surfaces in the dashboard as a "stuck permit" badge — opportunity for
-- a contractor to outreach the homeowner with "let me help unstick this".
--
-- Refreshed weekly by /api/cron/predictive-refresh.
--
-- Compute: for each (jurisdiction, permit_type) bucket, compute p95 of
-- the applied→issued gap. Any permit where its actual gap > p95 AND > 30
-- days is anomalous.
--
-- Tier A+ compliance: this table aggregates public permit timestamps.
-- No PII. No homeowner data. RLS via permit_id → lead_id → contractor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.permit_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id uuid NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,

  -- The jurisdiction key used for benchmarking (city + state, lowercase)
  jurisdiction_key text NOT NULL,

  -- The actual gap in days
  applied_to_issued_gap_days integer,

  -- The jurisdiction's p95 gap for this permit_type (the benchmark)
  jurisdiction_p95_gap_days integer,

  -- Anomaly score: actual_gap / p95_gap. >= 1.0 means anomalous.
  -- Capped at 10.0 to avoid extreme outliers skewing UI.
  anomaly_score numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (anomaly_score >= 0 AND anomaly_score <= 10),

  -- Whether to surface in the UI ("stuck permit" badge)
  is_stuck boolean NOT NULL DEFAULT false,

  computed_at timestamptz NOT NULL DEFAULT NOW(),

  -- One row per permit. UPSERT on refresh.
  UNIQUE (permit_id)
);

-- Index for the dashboard query: lookup by permit
CREATE INDEX IF NOT EXISTS permit_anomalies_permit_id_idx
  ON public.permit_anomalies (permit_id);

-- Index for "show me all stuck permits" filter
CREATE INDEX IF NOT EXISTS permit_anomalies_stuck_idx
  ON public.permit_anomalies (is_stuck, anomaly_score DESC)
  WHERE is_stuck = true;

-- RLS: contractor sees anomalies for permits in their leads
ALTER TABLE public.permit_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permit_anomalies_select_own" ON public.permit_anomalies;
CREATE POLICY "permit_anomalies_select_own" ON public.permit_anomalies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.permit_id = permit_anomalies.permit_id
        AND l.contractor_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.permit_anomalies IS
  'Cached stuck-permit detection per permit. Refreshed weekly by '
  '/api/cron/predictive-refresh. Tier A+ Sprint 1. NO PII.';

COMMIT;
