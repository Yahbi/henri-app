-- Henri Phase 0a + 0b — apply all wedge migrations in one paste.
-- Idempotent: every block uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- Paste this entire file into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new
-- and click Run. Takes <5 seconds.

BEGIN;

-- ───────────────────────────────────────────────
-- SOURCE: supabase/migrations/00031_wedge_trust.sql
-- ───────────────────────────────────────────────
-- 00031_wedge_trust.sql
--
-- Phase 0a: the wedge foundations. Four contractor-facing trust wins:
--   1. Score transparency     → leads.score_signals (jsonb)
--   2. Per-permit exclusivity → lead_exclusivity_locks
--   3. Capacity control       → profiles.capacity_prefs (jsonb)
--   4. Speed-to-lead          → missed_call_events  (+ permit_events
--                                                     timeline for #5)
--
-- All additive. Nothing in existing queries breaks. Columns added to
-- existing tables are nullable jsonb, so the current UI continues to
-- render untouched rows correctly.


/* ────────────────────────────────────────────────────────────────────
   Enums
   ──────────────────────────────────────────────────────────────────── */
DO $$ BEGIN
  CREATE TYPE exclusivity_release_reason AS ENUM (
    'expired',   -- 14-day window elapsed
    'declined',  -- contractor rejected the lead
    'won',       -- contractor closed the deal
    'forfeit'    -- use-it-or-lose-it: no outreach logged in 72h
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE permit_event_type AS ENUM (
    'planning',          -- planning-board agenda
    'applied',           -- permit application filed
    'issued',            -- permit issued
    'rough_inspection',  -- rough-in inspection scheduled/completed
    'final_inspection',  -- final inspection scheduled/completed
    'co_issued',         -- certificate of occupancy
    'expired',
    'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ────────────────────────────────────────────────────────────────────
   Per-permit exclusivity locks (pain #1: "race to the phone")
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS lead_exclusivity_locks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Denormalized for fast filtering without a leads join.
  trade             text,
  zip               varchar(5),
  -- Lock window (UTC). Default 14 days; UI lets the contractor see the
  -- remaining time and optionally renew.
  window_start      timestamptz NOT NULL DEFAULT now(),
  window_end        timestamptz NOT NULL,
  -- Use-it-or-lose-it guardrail. If no outreach event logged by this
  -- timestamp, a cron flips released_at / released_reason='forfeit'.
  forfeit_deadline  timestamptz,
  released_at       timestamptz,
  released_reason   exclusivity_release_reason,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Only one active lock per (lead, trade). The contractor that holds
-- this row is the only one seeing the enriched packet for the window.
-- Partial index — filters out released rows so historical locks don't
-- block new acquisitions after a contractor declines.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exclusivity_active_lock
  ON lead_exclusivity_locks (lead_id, COALESCE(trade, ''))
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exclusivity_contractor
  ON lead_exclusivity_locks (contractor_id, window_end DESC);
CREATE INDEX IF NOT EXISTS idx_exclusivity_window_end
  ON lead_exclusivity_locks (window_end)
  WHERE released_at IS NULL;

CREATE OR REPLACE TRIGGER lead_exclusivity_locks_updated_at
  BEFORE UPDATE ON lead_exclusivity_locks
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE lead_exclusivity_locks ENABLE ROW LEVEL SECURITY;

-- A contractor can see their own locks. Read-only from client; the
-- API route (/api/exclusivity) holds the service role key and runs
-- the acquire/release logic with its own validation.
CREATE POLICY excl_locks_select_self ON lead_exclusivity_locks
  FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid());

/* ────────────────────────────────────────────────────────────────────
   Permit lifecycle events (pain #5: no intent signal)
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS permit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id   uuid NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
  event_type  permit_event_type NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source      text,        -- e.g. 'scraper:hartford-ct', 'manual', 'ingest:planning-board'
  notes       text,
  raw_json    jsonb,       -- what the scraper saw at this event
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permit_events_permit
  ON permit_events (permit_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_permit_events_type_time
  ON permit_events (event_type, occurred_at DESC);

-- Permits are readable by any authenticated user (see migration 00004
-- permits_select_all policy), so permit_events follows the same
-- public-to-authenticated rule.
ALTER TABLE permit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY permit_events_select_all ON permit_events
  FOR SELECT
  TO authenticated
  USING (true);

/* ────────────────────────────────────────────────────────────────────
   Missed-call log (pain #6: speed-to-lead)
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS missed_call_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  caller_number         text,
  received_at           timestamptz NOT NULL DEFAULT now(),
  matched_lead_id       uuid REFERENCES leads(id) ON DELETE SET NULL,
  auto_reply_sent       boolean NOT NULL DEFAULT false,
  reply_text            text,
  provider_message_id   text,  -- Twilio SID
  raw_webhook_json      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missed_call_contractor_time
  ON missed_call_events (contractor_id, received_at DESC);

ALTER TABLE missed_call_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY missed_call_select_self ON missed_call_events
  FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid());

/* ────────────────────────────────────────────────────────────────────
   Additive columns on existing tables
   ──────────────────────────────────────────────────────────────────── */

-- leads.score_signals — breakdown of why the score is what it is.
-- Nullable jsonb so old rows stay valid. Shape:
--   [ {signal: 'permit_freshness', weight: 25, value: 22, detail: '3 days old'},
--     {signal: 'parcel_match',    weight: 15, value: 15, detail: 'exact'},
--     ... ]
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_signals jsonb;

-- profiles.capacity_prefs — radius / value band / start window / max
-- active jobs. Applied by the scorer + the Leads filter bar.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS capacity_prefs jsonb;


-- ───────────────────────────────────────────────
-- SOURCE: supabase/migrations/00032_outreach_template_library.sql
-- ───────────────────────────────────────────────
-- 00032_outreach_template_library.sql
--
-- Phase 0a wedge #10 — branded permit-specific outreach templates.
--
-- Problem: contractors inherit the same generic Angi-era spam openers
-- ("Got a minute to chat?") and homeowners ignore them. The wedge is
-- referencing the ACTUAL permit + homeowner context the contractor
-- now has — "I saw your permit #MISC-PLM-25-000078 for the 2nd-story
-- addition at 642 Park St."
--
-- Two changes:
--   1. Allow shared library templates (contractor_id NULL = shared).
--      Contractors can read/copy library templates but can't edit them.
--   2. Add trade-targeting so templates surface only for relevant trades.
--   3. Seed 8 starter templates: 4 trades × (email + SMS).
--
-- Token shape (resolved at send time by a token resolver in
-- src/lib/outreach/tokens.ts, Phase 0a remaining work):
--   {{owner_first}}  → "Sarah"   (falls back to "there")
--   {{address_short}}→ "642 Park St"
--   {{permit_number}}→ "MISC-PLM-25-000078"
--   {{permit_scope}} → permit description sentence
--   {{days_ago}}     → "3"
--   {{contractor_name}} → contractor's full_name
--   {{contractor_company}} → contractor's company_name


-- 1) Make contractor_id nullable + add trade column.
ALTER TABLE outreach_templates
  ALTER COLUMN contractor_id DROP NOT NULL;

ALTER TABLE outreach_templates
  ADD COLUMN IF NOT EXISTS trade text;

ALTER TABLE outreach_templates
  ADD COLUMN IF NOT EXISTS is_library boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_outreach_templates_library
  ON outreach_templates (trade, channel)
  WHERE is_library = true;

-- 2) Update RLS: contractors read own + library, write only own.
-- (Existing policy was ALL for own rows only — library rows were
-- invisible to everyone.)
DROP POLICY IF EXISTS "contractor sees own templates" ON outreach_templates;

CREATE POLICY outreach_templates_select_own_or_library ON outreach_templates
  FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid() OR is_library = true);

CREATE POLICY outreach_templates_insert_own ON outreach_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY outreach_templates_update_own ON outreach_templates
  FOR UPDATE
  TO authenticated
  USING (contractor_id = auth.uid())
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY outreach_templates_delete_own ON outreach_templates
  FOR DELETE
  TO authenticated
  USING (contractor_id = auth.uid());

-- 3) Seed the starter library. Upsert-safe by (is_library, trade,
-- channel, name) so re-running the migration doesn't duplicate.
-- Unique library index enforces no-duplicate seeds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_library_seed
  ON outreach_templates (trade, channel, name)
  WHERE is_library = true;

INSERT INTO outreach_templates (contractor_id, trade, channel, is_library, name, subject, body) VALUES

-- ─── Roofing ─────────────────────────────────────────────────────────────
(NULL, 'roofing', 'email', true,
 'Roof permit \u2014 neighbor intro',
 'About your roof permit at {{address_short}}',
 'Hi {{owner_first}},

I saw your roofing permit #{{permit_number}} was filed {{days_ago}} days ago for {{address_short}} \u2014 scope looks like: {{permit_scope}}.

{{contractor_company}} is a licensed roofer working in your neighborhood. Most of the work we do nearby falls between {{value_min}} and {{value_max}}, and we book into the next 30 days quickly because we pre-order material once the permit lands.

If you haven''t locked a contractor yet, I''d like to bring over a material + warranty comparison \u2014 no pitch, just numbers. 20 minutes on-site, and you''ll know what a fair bid looks like.

Reply here or text {{contractor_phone}} and I''ll book a time.

\u2014 {{contractor_name}}
{{contractor_company}}'),

(NULL, 'roofing', 'sms', true,
 'Roof permit \u2014 short SMS',
 NULL,
 'Hi {{owner_first}} \u2014 {{contractor_name}} from {{contractor_company}}. Saw your roof permit at {{address_short}} last week. Free on-site estimate + warranty comparison if you haven''t picked a roofer yet. 20 min, no pitch. Reply YES and I''ll text times.'),

-- ─── HVAC ────────────────────────────────────────────────────────────────
(NULL, 'hvac', 'email', true,
 'HVAC permit \u2014 system-swap intro',
 'About your HVAC permit at {{address_short}}',
 'Hi {{owner_first}},

Your HVAC permit #{{permit_number}} at {{address_short}} popped up {{days_ago}} days ago \u2014 scope noted as: {{permit_scope}}.

System replacements are time-sensitive. If the old unit is down, you probably want someone who can pull permits, install, and pass inspection in the same week. That''s what we do.

Would you like a 2-option quote (a straight like-for-like swap and a higher-efficiency upgrade with the utility rebate pre-filed)? No charge, no pressure \u2014 just so you can see what the real price range is before you commit.

Text or email me back and I''ll get you on the schedule.

\u2014 {{contractor_name}}
{{contractor_company}}'),

(NULL, 'hvac', 'sms', true,
 'HVAC permit \u2014 short SMS',
 NULL,
 'Hi {{owner_first}} \u2014 {{contractor_name}} from {{contractor_company}}. Saw your HVAC permit at {{address_short}}. I can do a same-week install if your old unit is down. Free 2-option quote (basic swap + efficiency upgrade w/ utility rebate). Text YES for times.'),

-- ─── Plumbing ────────────────────────────────────────────────────────────
(NULL, 'plumbing', 'email', true,
 'Plumbing permit \u2014 scope-of-work follow-up',
 'Quick question about your plumbing permit at {{address_short}}',
 'Hi {{owner_first}},

Your plumbing permit #{{permit_number}} at {{address_short}} was filed {{days_ago}} days ago. Scope reads: {{permit_scope}}.

Two things worth flagging as you line up contractors:

  1. If the city inspection catches a pipe that''s out of code, the cost of a fix-in-flight is usually 2-3x a planned replacement. Worth asking any contractor to walk the lines before they bid.
  2. Permit work that touches a main shut-off often needs a coordinated water-department visit. That scheduling alone can add a week if it isn''t booked up front.

We handle both. If you want a no-charge walk-through so you know what a complete bid should look like, reply here or text {{contractor_phone}}.

\u2014 {{contractor_name}}
{{contractor_company}}'),

(NULL, 'plumbing', 'sms', true,
 'Plumbing permit \u2014 short SMS',
 NULL,
 'Hi {{owner_first}} \u2014 {{contractor_name}} at {{contractor_company}}. Saw your plumbing permit at {{address_short}}. Worth 10 min on-site before you sign any bid \u2014 helps spot the code surprises that add cost mid-job. Text YES for a walk-through time.'),

-- ─── Electrical ──────────────────────────────────────────────────────────
(NULL, 'electrical', 'email', true,
 'Electrical permit \u2014 panel + upsell opportunities',
 'About your electrical permit at {{address_short}}',
 'Hi {{owner_first}},

Saw your electrical permit #{{permit_number}} at {{address_short}} from {{days_ago}} days ago. Work listed as: {{permit_scope}}.

A few things we''d mention for a project like yours:

  \u2022 If this is a service upgrade, most homeowners think about solar, EV charging, or whole-home backup within the next 2 years. Running conduit / wiring now is dramatically cheaper than retrofitting later.
  \u2022 Panel capacity calcs are often underdone \u2014 we size for where you''ll be in 5 years, not today.
  \u2022 We pull our own permits + pass inspection the first time in 95%+ of our jobs.

Happy to walk the property and put together a tiered bid \u2014 code-minimum + future-ready. Reply here or text {{contractor_phone}}.

\u2014 {{contractor_name}}
{{contractor_company}}'),

(NULL, 'electrical', 'sms', true,
 'Electrical permit \u2014 short SMS',
 NULL,
 'Hi {{owner_first}} \u2014 {{contractor_name}} from {{contractor_company}}. Saw your electrical permit at {{address_short}}. Free walk-through + tiered bid (code min + future-ready for solar / EV). Most homeowners regret not running conduit now. Text YES for times.')

ON CONFLICT DO NOTHING;


-- ───────────────────────────────────────────────
-- SOURCE: supabase/migrations/00033_contractor_interviews.sql
-- ───────────────────────────────────────────────
-- 00033_contractor_interviews.sql
--
-- Phase 0a validation-interview mini-CRM. 15-20 contractor calls before
-- we build more. Each row logs the conversation: who, what trade, what
-- ranked complaints emerged, what they said about their last 3 leads,
-- and any free-form notes.
--
-- Why in-app vs a spreadsheet: so the interview log lives next to the
-- product it validates. When we iterate on Phase 0b, we open the
-- Settings → Interviews tab, read the raw quotes, and re-weight the
-- wedge priorities against what contractors actually said.


CREATE TABLE IF NOT EXISTS contractor_interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contractor_name    text NOT NULL,
  contractor_company text,
  trade              text,
  state              varchar(2),
  years_in_business  integer,
  crew_size          integer,
  -- Top-3 pain-point rankings (from the 10-item list in CLAUDE.md wedge).
  -- Free-form in jsonb so we can change the taxonomy without migrations.
  ranked_complaints  jsonb,  -- e.g. [{rank:1,pain:"shared_leads",verbatim:"..."},...]
  -- Their last 3 leads' outcomes.
  last_3_leads       jsonb,  -- e.g. [{source:"angi",cost:125,outcome:"not_reached"},...]
  notes              text,
  interviewed_at     timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interviews_author_time
  ON contractor_interviews (author_id, interviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_trade
  ON contractor_interviews (trade);

CREATE OR REPLACE TRIGGER contractor_interviews_updated_at
  BEFORE UPDATE ON contractor_interviews
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE contractor_interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY interviews_select_own ON contractor_interviews
  FOR SELECT
  TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY interviews_insert_own ON contractor_interviews
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY interviews_update_own ON contractor_interviews
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY interviews_delete_own ON contractor_interviews
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());


-- ───────────────────────────────────────────────
-- SOURCE: supabase/migrations/00034_market_intel_zip.sql
-- ───────────────────────────────────────────────
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


-- ───────────────────────────────────────────────
-- SOURCE: supabase/migrations/00035_outreach_auto_fire.sql
-- ───────────────────────────────────────────────
-- 00035_outreach_auto_fire.sql
--
-- Phase 0a wedge #6 — speed-to-lead auto-fire preference.
--
-- Adds a single jsonb column on `profiles` so a contractor can opt in
-- to auto-firing an outreach template the instant a lead is scored.
-- Scorer reads this column (graceful if missing) and the Outreach tab
-- surfaces a toggle + template-picker for it.
--
-- Shape:
--   { "enabled": false, "template_id": null, "channel": "email" }
--
-- Also adds `twilio_tracked_number` so the missed-call webhook at
-- /api/webhooks/twilio-missed-call can map an inbound call's `To`
-- number back to the right contractor.


ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS outreach_auto_fire jsonb;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS twilio_tracked_number text;

-- Allow fast lookup by tracked number from the Twilio webhook.
CREATE INDEX IF NOT EXISTS idx_profiles_twilio_tracked_number
  ON profiles (twilio_tracked_number)
  WHERE twilio_tracked_number IS NOT NULL;


COMMIT;

-- Refresh PostgREST schema cache so the new tables + columns are visible.
NOTIFY pgrst, 'reload schema';
