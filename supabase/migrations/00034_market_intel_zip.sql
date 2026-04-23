-- 00034_market_intel_zip.sql
--
-- Phase 0b wedge #9 — market intelligence per ZIP.
--
-- Derived from the `permits` table we already maintain — no external
-- feeds needed. Aggregates trailing-90-day permit activity per ZIP:
-- permit counts, total value, top trades, top general contractors,
-- month-over-month trend. Refreshed nightly by /api/cron/market-intel.
--
-- Why a materialized view vs a live query: dashboard reads this on
-- every Intel-tab render (Phase 0b panel), and the aggregate scans
-- cost seconds on 925k+ rows. Precompute once per day, serve in <50ms.

BEGIN;

CREATE TABLE IF NOT EXISTS market_intel_zip (
  zip                varchar(5) PRIMARY KEY,
  state              varchar(2),
  as_of              timestamptz NOT NULL DEFAULT now(),
  -- Trailing 90 days
  permit_count_90d   integer NOT NULL DEFAULT 0,
  total_value_90d    bigint  NOT NULL DEFAULT 0,
  avg_value_90d      bigint  NOT NULL DEFAULT 0,
  -- Month-over-month delta (current 30d vs prior 30d)
  permit_count_mom_delta_pct numeric(6, 2),  -- e.g. 22.50 = +22.5%
  -- Top trades: jsonb array of {trade, count, total_value}
  top_trades         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Top 5 active applicants / contractors (from permits.applicant_name
  -- or raw_json.contractor_name when available): jsonb array of
  -- {name, count, total_value}
  top_applicants     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Trending: trades whose count > 3 and grew ≥25% MoM
  trending_up        jsonb NOT NULL DEFAULT '[]'::jsonb,
  trending_down      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_intel_state_count
  ON market_intel_zip (state, permit_count_90d DESC);

CREATE OR REPLACE TRIGGER market_intel_updated_at
  BEFORE UPDATE ON market_intel_zip
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Readable by any authenticated user — market intel is a shared
-- analytics surface across contractors in the same ZIP. No RLS
-- contractor-scoping needed (unlike leads / estimates / jobs).
ALTER TABLE market_intel_zip ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_intel_select_all ON market_intel_zip
  FOR SELECT
  TO authenticated
  USING (true);

/*
 * refresh_market_intel_zip() — nightly-cron function.
 *
 * Computes one row per ZIP that has ≥1 permit in the trailing 90 days.
 * Uses plpgsql because the top-trades / top-applicants rollups need
 * correlated subqueries that are ugly in a single SELECT. Full refresh
 * every run (TRUNCATE + INSERT) — sub-second on current data volumes.
 */
CREATE OR REPLACE FUNCTION refresh_market_intel_zip()
RETURNS TABLE(zips_refreshed integer) AS $$
DECLARE
  _count integer;
BEGIN
  TRUNCATE market_intel_zip;

  WITH recent AS (
    SELECT
      zip,
      state,
      permit_type,
      applicant_name,
      COALESCE(contractor_name, applicant_name) AS party,
      estimated_value,
      COALESCE(issued_date, applied_date, created_at::date) AS event_date
    FROM permits
    WHERE zip IS NOT NULL
      AND zip <> ''
      AND COALESCE(issued_date, applied_date, created_at::date) >= CURRENT_DATE - INTERVAL '90 days'
  ),
  by_zip AS (
    SELECT
      zip,
      MAX(state) AS state,
      COUNT(*)::integer AS permit_count_90d,
      COALESCE(SUM(estimated_value), 0)::bigint AS total_value_90d,
      COALESCE(AVG(estimated_value), 0)::bigint AS avg_value_90d,
      SUM(CASE WHEN event_date >= CURRENT_DATE - INTERVAL '30 days' THEN 1 ELSE 0 END)::integer AS cur_30d,
      SUM(CASE WHEN event_date <  CURRENT_DATE - INTERVAL '30 days'
               AND event_date >= CURRENT_DATE - INTERVAL '60 days' THEN 1 ELSE 0 END)::integer AS prior_30d
    FROM recent
    GROUP BY zip
  ),
  top_trades_per_zip AS (
    SELECT
      zip,
      jsonb_agg(jsonb_build_object(
        'trade', permit_type::text,
        'count', cnt,
        'total_value', tv
      ) ORDER BY cnt DESC) FILTER (WHERE rn <= 5) AS top_trades
    FROM (
      SELECT
        zip,
        permit_type,
        COUNT(*)::integer AS cnt,
        COALESCE(SUM(estimated_value), 0)::bigint AS tv,
        ROW_NUMBER() OVER (PARTITION BY zip ORDER BY COUNT(*) DESC) AS rn
      FROM recent
      WHERE permit_type IS NOT NULL
      GROUP BY zip, permit_type
    ) ranked
    GROUP BY zip
  ),
  top_applicants_per_zip AS (
    SELECT
      zip,
      jsonb_agg(jsonb_build_object(
        'name', party,
        'count', cnt,
        'total_value', tv
      ) ORDER BY cnt DESC) FILTER (WHERE rn <= 5) AS top_applicants
    FROM (
      SELECT
        zip,
        party,
        COUNT(*)::integer AS cnt,
        COALESCE(SUM(estimated_value), 0)::bigint AS tv,
        ROW_NUMBER() OVER (PARTITION BY zip ORDER BY COUNT(*) DESC) AS rn
      FROM recent
      WHERE party IS NOT NULL AND party <> ''
      GROUP BY zip, party
    ) ranked
    GROUP BY zip
  )
  INSERT INTO market_intel_zip (
    zip, state, as_of,
    permit_count_90d, total_value_90d, avg_value_90d,
    permit_count_mom_delta_pct,
    top_trades, top_applicants,
    trending_up, trending_down
  )
  SELECT
    z.zip,
    z.state,
    now(),
    z.permit_count_90d,
    z.total_value_90d,
    z.avg_value_90d,
    CASE
      WHEN z.prior_30d = 0 AND z.cur_30d > 0 THEN 100.0
      WHEN z.prior_30d = 0 THEN NULL
      ELSE ROUND((z.cur_30d - z.prior_30d)::numeric / z.prior_30d * 100, 2)
    END AS permit_count_mom_delta_pct,
    COALESCE(t.top_trades, '[]'::jsonb),
    COALESCE(a.top_applicants, '[]'::jsonb),
    '[]'::jsonb,   -- trending_up placeholder — computed in a follow-up pass
    '[]'::jsonb    -- trending_down placeholder
  FROM by_zip z
  LEFT JOIN top_trades_per_zip t USING (zip)
  LEFT JOIN top_applicants_per_zip a USING (zip);

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN QUERY SELECT _count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_market_intel_zip() TO service_role;

COMMIT;
