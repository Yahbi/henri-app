-- 00016_marketplace_engine.sql
-- Marketplace infrastructure: reviews, quotes, job lifecycle,
-- engagement scoring, follow-up automation, cost benchmarks, ZIP demand

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. REVIEWS — real review collection, not Google scraping
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id),
  reviewer_name   text NOT NULL,
  reviewer_email  text,
  reviewer_phone  text,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           text,
  body            text,
  trade           text,
  zip             text,
  sentiment       text CHECK (sentiment IN ('positive','neutral','negative')),
  ai_response     text,
  response_sent   boolean NOT NULL DEFAULT false,
  verified        boolean NOT NULL DEFAULT false,
  source          text NOT NULL DEFAULT 'henri' CHECK (source IN ('henri','google','yelp','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reviews_contractor ON reviews(contractor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating     ON reviews(contractor_id, rating);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY reviews_select_public ON reviews
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reviews_insert ON reviews
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reviews_update_own ON reviews
    FOR UPDATE TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 2. REVIEW REQUESTS — automated post-job review solicitation
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE review_request_status AS ENUM ('pending','sent','completed','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS review_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES leads(id),
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  channel         text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','both')),
  status          review_request_status NOT NULL DEFAULT 'pending',
  token           text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  review_id       uuid REFERENCES reviews(id),
  sent_at         timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_token ON review_requests(token);
CREATE INDEX IF NOT EXISTS idx_review_requests_contractor   ON review_requests(contractor_id);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY review_requests_own ON review_requests
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 3. QUOTES — homeowner ↔ contractor quote flow
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('requested','draft','sent','viewed','accepted','declined','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  homeowner_id    uuid REFERENCES profiles(id),
  intake_id       uuid REFERENCES homeowner_intakes(id),
  lead_id         uuid REFERENCES leads(id),

  -- Project details
  trade           text NOT NULL,
  zip             text NOT NULL,
  description     text,
  scope_notes     text,

  -- Pricing (Good/Better/Best)
  tier_good       jsonb,   -- { label, total, line_items: [] }
  tier_better     jsonb,
  tier_best       jsonb,
  selected_tier   text CHECK (selected_tier IN ('good','better','best')),

  -- Financing
  financing_available boolean NOT NULL DEFAULT false,
  monthly_payment     numeric(10,2),

  -- Status
  status          quote_status NOT NULL DEFAULT 'requested',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  viewed_at       timestamptz,
  responded_at    timestamptz,
  expires_at      timestamptz DEFAULT (now() + interval '14 days'),

  -- Metadata
  message         text,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_contractor ON quotes(contractor_id);
CREATE INDEX IF NOT EXISTS idx_quotes_homeowner  ON quotes(homeowner_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status     ON quotes(contractor_id, status);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY quotes_contractor ON quotes
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY quotes_homeowner ON quotes
    FOR SELECT TO authenticated
    USING (homeowner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 4. JOB MILESTONES — track job lifecycle from contract to payment
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('upcoming','in_progress','completed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES profiles(id),
  title           text NOT NULL,
  description     text,
  sort_order      smallint NOT NULL DEFAULT 0,
  status          milestone_status NOT NULL DEFAULT 'upcoming',
  scheduled_date  date,
  completed_date  date,
  payment_amount  numeric(10,2),
  payment_status  text CHECK (payment_status IN ('pending','invoiced','paid')),
  photos          text[],
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_lead ON job_milestones(lead_id);

ALTER TABLE job_milestones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY milestones_contractor ON job_milestones
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 5. FOLLOW-UP SEQUENCES — automated drip outreach
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS follow_up_sequences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  trigger_status  text NOT NULL,  -- lead status that starts the sequence
  steps           jsonb NOT NULL DEFAULT '[]',
  -- steps: [{ delay_hours, channel, template, subject, body }]
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE follow_up_sequences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY sequences_own ON follow_up_sequences
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Outreach queue: individual scheduled messages from sequences
CREATE TABLE IF NOT EXISTS outreach_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES profiles(id),
  lead_id         uuid NOT NULL REFERENCES leads(id),
  sequence_id     uuid REFERENCES follow_up_sequences(id),
  step_index      smallint NOT NULL DEFAULT 0,
  channel         text NOT NULL CHECK (channel IN ('email','sms')),
  recipient       text NOT NULL,
  subject         text,
  body            text NOT NULL,
  scheduled_for   timestamptz NOT NULL,
  sent_at         timestamptz,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_queue_scheduled
  ON outreach_queue(scheduled_for)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_outreach_queue_contractor
  ON outreach_queue(contractor_id);

ALTER TABLE outreach_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY outreach_queue_own ON outreach_queue
    FOR ALL TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 6. ENGAGEMENT SCORES — predict churn, rank contractors
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS engagement_scores (
  contractor_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  login_score       smallint NOT NULL DEFAULT 0,    -- 0-25
  lead_action_score smallint NOT NULL DEFAULT 0,    -- 0-25
  outreach_score    smallint NOT NULL DEFAULT 0,    -- 0-25
  conversion_score  smallint NOT NULL DEFAULT 0,    -- 0-25
  total_score       smallint NOT NULL DEFAULT 0,    -- 0-100
  tier              text NOT NULL DEFAULT 'bronze',
  churn_risk        text NOT NULL DEFAULT 'low' CHECK (churn_risk IN ('low','medium','high','critical')),
  last_login        timestamptz,
  last_lead_action  timestamptz,
  leads_30d         int NOT NULL DEFAULT 0,
  contacted_30d     int NOT NULL DEFAULT 0,
  won_30d           int NOT NULL DEFAULT 0,
  revenue_30d       numeric(12,2) NOT NULL DEFAULT 0,
  avg_response_h    numeric(6,1),
  close_rate        numeric(5,2),
  computed_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE engagement_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY engagement_own ON engagement_scores
    FOR SELECT TO authenticated
    USING (contractor_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 7. ZIP DEMAND SCORES — territory intelligence
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS zip_demand_scores (
  zip               text PRIMARY KEY,
  permits_30d       int NOT NULL DEFAULT 0,
  permits_trend_pct numeric(6,2),  -- MoM %
  avg_project_value numeric(12,2),
  contractor_density smallint NOT NULL DEFAULT 0,
  demand_score      smallint NOT NULL DEFAULT 0,  -- 0-100
  competition_level text NOT NULL DEFAULT 'medium'
    CHECK (competition_level IN ('low','medium','high','saturated')),
  top_trade         text,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- 8. COST BENCHMARKS — regional pricing data for estimator
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cost_benchmarks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade           text NOT NULL,
  project_type    text NOT NULL,
  zip_prefix      text NOT NULL,  -- first 3 digits of ZIP
  cost_low        numeric(10,2) NOT NULL,
  cost_avg        numeric(10,2) NOT NULL,
  cost_high       numeric(10,2) NOT NULL,
  unit            text NOT NULL DEFAULT 'project',  -- project, sqft, linear_ft
  sample_size     int NOT NULL DEFAULT 0,
  last_updated    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_benchmark UNIQUE (trade, project_type, zip_prefix)
);

-- ══════════════════════════════════════════════════════════════
-- 9. CONTRACTOR PUBLIC PROFILE fields on profiles table
-- ══════════════════════════════════════════════════════════════
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio              text,
  ADD COLUMN IF NOT EXISTS service_area     text[],
  ADD COLUMN IF NOT EXISTS specialties      text[],
  ADD COLUMN IF NOT EXISTS years_experience smallint,
  ADD COLUMN IF NOT EXISTS portfolio_photos text[],
  ADD COLUMN IF NOT EXISTS avg_rating       numeric(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_time_h  numeric(6,1),
  ADD COLUMN IF NOT EXISTS jobs_completed   int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_public   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS badge_licensed   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_insured    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_background boolean DEFAULT false;

-- ══════════════════════════════════════════════════════════════
-- 10. MATERIALIZED VIEW: contractor leaderboard
-- ══════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS contractor_leaderboard AS
SELECT
  p.id,
  p.company_name,
  p.trade,
  p.avg_rating,
  p.review_count,
  p.jobs_completed,
  p.response_time_h,
  p.badge_licensed,
  p.badge_insured,
  p.badge_background,
  p.verified_at,
  COALESCE(e.total_score, 0) AS engagement_score,
  COALESCE(e.close_rate, 0)  AS close_rate,
  COALESCE(e.revenue_30d, 0) AS revenue_30d,
  array_agg(DISTINCT t.zip) FILTER (WHERE t.zip IS NOT NULL) AS territory_zips
FROM profiles p
LEFT JOIN engagement_scores e ON e.contractor_id = p.id
LEFT JOIN territories t ON t.contractor_id = p.id AND t.status = 'active'
WHERE p.role = 'contractor'
  AND p.onboarding_completed = true
GROUP BY p.id, p.company_name, p.trade, p.avg_rating, p.review_count,
         p.jobs_completed, p.response_time_h, p.badge_licensed, p.badge_insured,
         p.badge_background, p.verified_at, e.total_score, e.close_rate, e.revenue_30d;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_id ON contractor_leaderboard(id);

-- ══════════════════════════════════════════════════════════════
-- 11. RPC: refresh_contractor_stats
--     Updates avg_rating, review_count, response_time on profiles
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_contractor_stats(p_contractor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_avg    numeric(3,2);
  v_count  int;
  v_resp_h numeric(6,1);
  v_jobs   int;
BEGIN
  -- Reviews
  SELECT COALESCE(AVG(rating), 0), COUNT(*)
    INTO v_avg, v_count
    FROM reviews
   WHERE contractor_id = p_contractor_id;

  -- Response time (median of last 30 leads)
  SELECT COALESCE(
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (contacted_at - created_at)) / 3600
    ), NULL)
    INTO v_resp_h
    FROM (
      SELECT contacted_at, created_at
        FROM leads
       WHERE contractor_id = p_contractor_id
         AND contacted_at IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 30
    ) sub;

  -- Jobs completed
  SELECT COUNT(*) INTO v_jobs
    FROM leads
   WHERE contractor_id = p_contractor_id
     AND status = 'won';

  UPDATE profiles SET
    avg_rating      = v_avg,
    review_count    = v_count,
    response_time_h = v_resp_h,
    jobs_completed  = v_jobs
  WHERE id = p_contractor_id;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 12. SEED COST BENCHMARKS (national averages by trade)
-- ══════════════════════════════════════════════════════════════
INSERT INTO cost_benchmarks (trade, project_type, zip_prefix, cost_low, cost_avg, cost_high, unit, sample_size)
VALUES
  -- Roofing
  ('roofing', 'Full Roof Replacement', '900', 8500, 12500, 22000, 'project', 340),
  ('roofing', 'Full Roof Replacement', '902', 9200, 14000, 25000, 'project', 280),
  ('roofing', 'Full Roof Replacement', '100', 7500, 11000, 18000, 'project', 420),
  ('roofing', 'Full Roof Replacement', '606', 6800, 10200, 16500, 'project', 310),
  ('roofing', 'Full Roof Replacement', '770', 6200, 9500, 15000, 'project', 350),
  ('roofing', 'Roof Repair', '900', 350, 850, 2500, 'project', 890),
  ('roofing', 'Roof Repair', '100', 300, 750, 2200, 'project', 920),
  -- HVAC
  ('hvac', 'AC Replacement', '900', 4200, 7500, 12000, 'project', 450),
  ('hvac', 'AC Replacement', '100', 3800, 6500, 11000, 'project', 380),
  ('hvac', 'AC Replacement', '606', 3500, 6000, 10500, 'project', 290),
  ('hvac', 'AC Replacement', '770', 3200, 5800, 9500, 'project', 520),
  ('hvac', 'Furnace Replacement', '900', 3000, 5500, 9000, 'project', 310),
  ('hvac', 'Full HVAC System', '900', 8000, 15000, 28000, 'project', 180),
  -- Plumbing
  ('plumbing', 'Whole House Repipe', '900', 4500, 8000, 15000, 'project', 210),
  ('plumbing', 'Whole House Repipe', '100', 3800, 7200, 13000, 'project', 190),
  ('plumbing', 'Water Heater', '900', 1200, 2200, 4500, 'project', 680),
  ('plumbing', 'Sewer Line', '900', 3000, 6500, 15000, 'project', 140),
  -- Electrical
  ('electrical', 'Panel Upgrade', '900', 1800, 3200, 5500, 'project', 320),
  ('electrical', 'Panel Upgrade', '100', 1500, 2800, 5000, 'project', 290),
  ('electrical', 'Whole House Rewire', '900', 8000, 15000, 30000, 'project', 95),
  ('electrical', 'EV Charger Install', '900', 800, 1500, 3000, 'project', 410),
  -- Kitchen
  ('general remodel', 'Kitchen Remodel', '900', 25000, 45000, 85000, 'project', 240),
  ('general remodel', 'Kitchen Remodel', '100', 22000, 40000, 75000, 'project', 220),
  ('general remodel', 'Kitchen Remodel', '606', 18000, 35000, 65000, 'project', 180),
  -- Bathroom
  ('general remodel', 'Bathroom Remodel', '900', 12000, 22000, 45000, 'project', 350),
  ('general remodel', 'Bathroom Remodel', '100', 10000, 18000, 38000, 'project', 310),
  -- ADU
  ('adu', 'ADU Construction', '900', 120000, 200000, 350000, 'project', 85),
  ('adu', 'ADU Construction', '100', 95000, 165000, 280000, 'project', 60),
  -- Solar
  ('solar', 'Residential Solar', '900', 15000, 22000, 35000, 'project', 520),
  ('solar', 'Residential Solar', '100', 12000, 18000, 28000, 'project', 380),
  ('solar', 'Solar + Battery', '900', 25000, 38000, 55000, 'project', 210),
  -- Windows
  ('windows', 'Full Window Replacement', '900', 8000, 15000, 30000, 'project', 270),
  ('windows', 'Full Window Replacement', '100', 7000, 12000, 24000, 'project', 240),
  -- Painting
  ('painting', 'Exterior Paint', '900', 3500, 6500, 12000, 'project', 480),
  ('painting', 'Interior Paint', '900', 2000, 4500, 9000, 'project', 560),
  -- Foundation
  ('foundation', 'Foundation Repair', '900', 5000, 12000, 30000, 'project', 120),
  ('foundation', 'Foundation Repair', '770', 4000, 9500, 22000, 'project', 140),
  -- Landscaping
  ('landscaping', 'Full Landscape', '900', 8000, 20000, 50000, 'project', 190),
  ('landscaping', 'Hardscape/Patio', '900', 5000, 12000, 30000, 'project', 220)
ON CONFLICT (trade, project_type, zip_prefix) DO NOTHING;

COMMIT;
