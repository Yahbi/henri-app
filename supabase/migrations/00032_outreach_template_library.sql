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

BEGIN;

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

COMMIT;
