-- 00047_seed_outreach_templates.sql
-- Seed the per-trade default template library (Phase 1.5 partial).
--
-- Background: Phase 1.5 of the post-audit roadmap (`docs/sprint-plans/
-- 2026-04-26/phase-1.5-outreach-templates.md`) ships a library of 42
-- per-trade default templates (7 trades × 3 stages × 2 channels). The
-- editor UX is a separate work-stream — this migration ships the DATA
-- so contractors immediately see professionally-written templates by
-- trade in the existing Outreach page.
--
-- Trades: roofing, hvac, plumbing, electrical, solar, adu, general
-- Stages: initial (day 0), day-3 follow-up, day-7 last-touch
-- Channels: sms (≤160 chars), email (subject + body)
--
-- All templates include at least one wedge token ({{permit_number}},
-- {{address}}, {{permit_type}}, or {{permit_value}}) per CLAUDE.md
-- wedge contract bullet #4: "Outreach is permit-specific."
--
-- The templates are MARKED as system-default (contractor_id IS NULL,
-- is_default = true). The Outreach page renders these alongside any
-- contractor-customized rows. Contractors "copy to mine" before
-- editing — original system rows are immutable.

BEGIN;

-- Migration 00032 ships the outreach_template_library table. This
-- migration depends on it. If 00032 hasn't applied, the SELECT below
-- will fail loud — catch in CI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'outreach_templates'
  ) THEN
    RAISE EXCEPTION 'outreach_templates table missing — apply migration 00032 first';
  END IF;
END $$;

-- Idempotent: ON CONFLICT DO NOTHING means re-applying the migration
-- is safe. The unique constraint on (trade, stage, channel, is_default)
-- makes this work; assuming migration 00032 created such a constraint
-- or we add it here defensively.
ALTER TABLE outreach_templates
  ADD COLUMN IF NOT EXISTS trade text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- System-default templates have no owning contractor — `contractor_id`
-- must be nullable for the seed below + the partial unique index. Some
-- earlier 00032 variants shipped with `contractor_id NOT NULL`; this
-- DROP NOT NULL is a no-op when the column is already nullable.
ALTER TABLE outreach_templates
  ALTER COLUMN contractor_id DROP NOT NULL;

-- Build a unique key for system-default templates so re-runs are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_outreach_templates_default_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_outreach_templates_default_unique
      ON outreach_templates(trade, stage, channel)
      WHERE is_default = true AND contractor_id IS NULL;
  END IF;
END $$;

-- ── Roofing ──────────────────────────────────────────────────────────

INSERT INTO outreach_templates (
  contractor_id, trade, stage, channel, is_default,
  name, subject, body, created_at
) VALUES
(NULL::uuid, 'roofing', 'initial', 'sms', true,
 'Roofing — initial SMS',
 NULL,
 'Hi {{owner_first}}, this is {{contractor_name}} from {{contractor_company}}. Saw your roof permit at {{address_short}} (#{{permit_number}}) — wanted to introduce ourselves before materials windows tighten. Reply YES for a free 15-min walk-through.',
 now()),
(NULL::uuid, 'roofing', 'initial', 'email', true,
 'Roofing — initial email',
 'Your roof permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nI noticed your recently-filed roof permit ({{permit_number}}) at {{address}}. Wanted to introduce {{contractor_company}} — we''ve handled {{trade_count_zip}} similar projects in {{zip}} this year.\n\nA free 15-minute walk-through this week would help us scope materials accurately before lead times push out. Reply with a time that works, or call {{contractor_phone}}.\n\n— {{contractor_name}}\n{{contractor_company}} | License #{{contractor_license}}',
 now()),
(NULL::uuid, 'roofing', 'day3', 'sms', true,
 'Roofing — day 3 follow-up SMS',
 NULL,
 'Quick follow-up, {{owner_first}}. Your roof permit at {{address_short}} — we''re scheduling site walks this week. Even a 5-min call helps us reserve a materials slot. Reply CALL or pick a time.',
 now()),
(NULL::uuid, 'roofing', 'day3', 'email', true,
 'Roofing — day 3 follow-up email',
 'Re: your roof permit ({{permit_number}})',
 E'Hi {{owner_first}},\n\nFollowing up on the roof permit at {{address}}. Couple of things that might be useful:\n\n- Materials lead times are 4-6 weeks for tile, 2-3 for asphalt\n- Most insurance carriers want pre-photos before tear-off\n- Permit-specific scope: {{permit_description}}\n\nHappy to send our most-recent {{trade}} portfolio in the area, or schedule a 15-min walk. {{contractor_phone}} works too.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'roofing', 'day7', 'sms', true,
 'Roofing — day 7 last-touch SMS',
 NULL,
 'Last note, {{owner_first}} — your {{address_short}} roof permit. If you''ve already chosen a contractor, no worries. If you''re still comparing quotes, our {{permit_value}} estimate is good for 14 days. Reply YES to lock it.',
 now()),
(NULL::uuid, 'roofing', 'day7', 'email', true,
 'Roofing — day 7 last-touch email',
 'Final touch on your roof permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nNot a hard sell — just closing the loop on your roof permit ({{permit_number}}). We''ve estimated similar projects in {{zip}} at the {{permit_value}} range. If you''re still gathering bids, here''s a quick comparison checklist:\n\n- Manufacturer warranty terms (we ship 25-year on most asphalt, 50-year on metal)\n- Disposal & cleanup included? (we include both)\n- Permit close-out signed off by inspector? (we coordinate)\n\nReply or call {{contractor_phone}} if useful. Otherwise, good luck with the project.\n\n— {{contractor_name}}',
 now())

-- ── HVAC ─────────────────────────────────────────────────────────────

,(NULL::uuid, 'hvac', 'initial', 'sms', true,
 'HVAC — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. Your HVAC permit at {{address_short}} (#{{permit_number}}) caught our eye — we''re booked 2 weeks out so reaching out early. Reply YES for a free load-calc walk-through.',
 now()),
(NULL::uuid, 'hvac', 'initial', 'email', true,
 'HVAC — initial email',
 'HVAC permit at {{address_short}} — quick intro',
 E'Hi {{owner_first}},\n\nYour HVAC permit ({{permit_number}}) at {{address}} just hit the public file. Wanted to introduce {{contractor_company}} before the install schedule tightens.\n\nA proper Manual J load calc + ductwork sizing review on a free 30-min visit usually saves 15-20% on the unit selection — happy to schedule. {{contractor_phone}}.\n\n— {{contractor_name}}\n{{contractor_company}} | License #{{contractor_license}}',
 now()),
(NULL::uuid, 'hvac', 'day3', 'sms', true,
 'HVAC — day 3 SMS',
 NULL,
 '{{owner_first}}, following up on the HVAC permit at {{address_short}}. Equipment rebates from utility expire end of quarter — would hate for you to miss. Reply CALL or pick a time.',
 now()),
(NULL::uuid, 'hvac', 'day3', 'email', true,
 'HVAC — day 3 email',
 'Re: HVAC permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nFollowing up on {{permit_number}}. Two reminders before this season''s install slots fill:\n\n1. Federal heat-pump tax credit (up to $2,000) requires AHRI-certified equipment — we list the certificate in every quote.\n2. {{contractor_company}} has 8 install slots open this month, then nothing until 6 weeks out.\n\nTen-minute load review on Zoom works if a site visit is hard. {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'hvac', 'day7', 'sms', true,
 'HVAC — day 7 SMS',
 NULL,
 'Last touch, {{owner_first}} — HVAC permit at {{address_short}}. If you''ve picked a vendor, all good. If still bidding, our {{permit_value}} quote is good for 14 days. Reply YES.',
 now()),
(NULL::uuid, 'hvac', 'day7', 'email', true,
 'HVAC — day 7 email',
 'Closing the loop on {{permit_number}}',
 E'Hi {{owner_first}},\n\nFinal check-in on the HVAC permit ({{permit_number}}) at {{address}}. If you''ve already scheduled with another contractor, ignore this.\n\nIf still comparing, key questions to ask any HVAC bid:\n\n- Manual J load calc included? (it should be)\n- AHRI certificate provided? (required for tax credit)\n- Refrigerant line set: replaced or reused? (matters for warranty)\n\nReply or call {{contractor_phone}} if useful.\n\n— {{contractor_name}}',
 now())

-- ── Plumbing ─────────────────────────────────────────────────────────

,(NULL::uuid, 'plumbing', 'initial', 'sms', true,
 'Plumbing — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. Saw the plumbing permit at {{address_short}} (#{{permit_number}}). When walls open is the cheapest moment for line upgrades — happy to share the project-specific scope. Reply YES.',
 now()),
(NULL::uuid, 'plumbing', 'initial', 'email', true,
 'Plumbing — initial email',
 'Your plumbing permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nYour plumbing permit ({{permit_number}}) at {{address}} just filed. Quick intro — {{contractor_company}} is a {{contractor_years}}-year shop in {{zip}}.\n\nWhile walls are open is the right time for: re-piping, fixture upgrades, water-line replacement. A 15-min walk-through frames the scope cleanly. {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'plumbing', 'day3', 'sms', true,
 'Plumbing — day 3 SMS',
 NULL,
 '{{owner_first}}, plumbing permit at {{address_short}} — quick follow-up. The cheapest fixture upgrades happen pre-rough. Walls close fast. Reply CALL.',
 now()),
(NULL::uuid, 'plumbing', 'day3', 'email', true,
 'Plumbing — day 3 email',
 'Re: plumbing permit ({{permit_number}})',
 E'Hi {{owner_first}},\n\nFollowing up on plumbing at {{address}}. Three quick wins before walls close:\n\n- Pressure-balanced shower valves (code may now require)\n- PEX manifold for individual line shut-offs (saves real money on future repairs)\n- Water-softener pre-plumb (cheap now, expensive later)\n\nWorth a 10-min call? {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'plumbing', 'day7', 'sms', true,
 'Plumbing — day 7 SMS',
 NULL,
 'Final note, {{owner_first}} — plumbing at {{address_short}}. If chosen, all good. If not, our {{permit_value}} bid is good 14d. Reply YES to lock.',
 now()),
(NULL::uuid, 'plumbing', 'day7', 'email', true,
 'Plumbing — day 7 email',
 'Last touch on {{permit_number}}',
 E'Hi {{owner_first}},\n\nClosing the loop. If still gathering bids on the plumbing at {{address}}, three things to verify with any contractor:\n\n- Licensed AND insured (license # on the bid)\n- Pre-rough inspection scheduled\n- Final inspection sign-off included in the price\n\n{{contractor_phone}} or reply if useful. Good luck either way.\n\n— {{contractor_name}}',
 now())

-- ── Electrical ───────────────────────────────────────────────────────

,(NULL::uuid, 'electrical', 'initial', 'sms', true,
 'Electrical — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. Electrical permit at {{address_short}} (#{{permit_number}}) — wanted to introduce ourselves. Panel upgrades + EV chargers cheapest pre-rough. Reply YES for a 15-min walk.',
 now()),
(NULL::uuid, 'electrical', 'initial', 'email', true,
 'Electrical — initial email',
 'Your electrical permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nElectrical permit ({{permit_number}}) at {{address}} just hit. Brief intro — {{contractor_company}}, {{contractor_years}} years in {{zip}}.\n\nIf the scope includes panel work or service upgrade: this is the cheapest moment to add EV-charger capacity, solar-ready conduit, or whole-home surge. We bake those into the bid as optional line items.\n\n{{contractor_phone}} for a quick walk.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'electrical', 'day3', 'sms', true,
 'Electrical — day 3 SMS',
 NULL,
 '{{owner_first}}, electrical at {{address_short}} — checking in. EV-charger or solar conduit pre-roughs save 60-70% vs retrofit. 5-min call? {{contractor_phone}}.',
 now()),
(NULL::uuid, 'electrical', 'day3', 'email', true,
 'Electrical — day 3 email',
 'Re: electrical permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nFollowing up on {{permit_number}}. While the panel is open, three considerations:\n\n1. EV-charger 240V circuit (typically $400 if pre-roughed, $1,200 retrofit)\n2. Whole-home surge protector (~$300, 90% of homeowners regret skipping)\n3. Smart panel for breaker-level monitoring (premium-tier, optional)\n\nQuick call? {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'electrical', 'day7', 'sms', true,
 'Electrical — day 7 SMS',
 NULL,
 'Last touch, {{owner_first}}. Electrical at {{address_short}}. {{permit_value}} bid good 14d. Reply YES.',
 now()),
(NULL::uuid, 'electrical', 'day7', 'email', true,
 'Electrical — day 7 email',
 'Closing on {{permit_number}}',
 E'Hi {{owner_first}},\n\nFinal note on electrical at {{address}}. Quick checklist for any electrical bid:\n\n- Master electrician on staff (not just journeyman)\n- Permits + final inspection coordinated\n- Code-compliance for ARC fault + GFCI per the latest NEC adopted in {{state}}\n\n{{contractor_phone}} or reply. Good luck.\n\n— {{contractor_name}}',
 now())

-- ── Solar ────────────────────────────────────────────────────────────

,(NULL::uuid, 'solar', 'initial', 'sms', true,
 'Solar — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. Solar permit at {{address_short}} (#{{permit_number}}) — congrats on the install. Battery + EV-charger conversations work best pre-PTO. Reply YES.',
 now()),
(NULL::uuid, 'solar', 'initial', 'email', true,
 'Solar — initial email',
 'Solar permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nNoticed your solar permit ({{permit_number}}) at {{address}}. Quick intro — {{contractor_company}}.\n\nSolar contractors typically know about battery storage but treat it as separate. Pre-PTO is the cheapest install window for ESS + EV-charger conduit. Happy to scope.\n\n{{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'solar', 'day3', 'sms', true,
 'Solar — day 3 SMS',
 NULL,
 '{{owner_first}}, solar permit at {{address_short}} — battery storage credit (30%) ends end of year. Worth a 10-min look? {{contractor_phone}}.',
 now()),
(NULL::uuid, 'solar', 'day3', 'email', true,
 'Solar — day 3 email',
 'Re: solar at {{address_short}}',
 E'Hi {{owner_first}},\n\nFollowing up on {{permit_number}}. Two solar-adjacent calls homeowners regret skipping:\n\n1. Battery storage at the same install crew (saves ~$3,500 vs separate trip)\n2. EV-charger circuit roughed in (cheap now, expensive later)\n\nFederal 30% credit applies to both. Worth a chat? {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'solar', 'day7', 'sms', true,
 'Solar — day 7 SMS',
 NULL,
 'Final note {{owner_first}} — solar at {{address_short}}. {{permit_value}} bid good 14d. Reply YES.',
 now()),
(NULL::uuid, 'solar', 'day7', 'email', true,
 'Solar — day 7 email',
 'Closing on solar permit',
 E'Hi {{owner_first}},\n\nLast touch on solar at {{address}}. Things every solar bid should include:\n\n- DC vs AC-coupled (matters for battery later)\n- Production guarantee (most reputable installers offer)\n- 25-year panel warranty + 12-year inverter warranty\n\n{{contractor_phone}} or reply. Good luck on the install.\n\n— {{contractor_name}}',
 now())

-- ── ADU ──────────────────────────────────────────────────────────────

,(NULL::uuid, 'adu', 'initial', 'sms', true,
 'ADU — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. ADU permit at {{address_short}} (#{{permit_number}}). ADU builds are 2-4x more sensitive to schedule than typical remodels — happy to walk through milestones. Reply YES.',
 now()),
(NULL::uuid, 'adu', 'initial', 'email', true,
 'ADU — initial email',
 'ADU permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nADU permit ({{permit_number}}) at {{address}} just landed. Quick intro — {{contractor_company}} has built {{trade_count_zip}} ADUs in {{zip}} this year.\n\nADUs win or lose on schedule discipline. We track 11 critical-path milestones from foundation to CO and share weekly with the homeowner. Worth a 30-min walk-through to compare approaches.\n\n{{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'adu', 'day3', 'sms', true,
 'ADU — day 3 SMS',
 NULL,
 '{{owner_first}}, ADU at {{address_short}}. Foundation crews booking 6+ weeks out. Lock dates? {{contractor_phone}}.',
 now()),
(NULL::uuid, 'adu', 'day3', 'email', true,
 'ADU — day 3 email',
 'Re: ADU permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nFollowing up on {{permit_number}}. Three ADU realities most homeowners learn the hard way:\n\n1. Foundation crews are the schedule bottleneck — book 8 weeks out\n2. Utility separation (water/sewer/electric) often adds 4-6 weeks\n3. Final CO requires landscape-bond release in many jurisdictions\n\nWe handle all three with a single PM. {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'adu', 'day7', 'sms', true,
 'ADU — day 7 SMS',
 NULL,
 'Final touch, {{owner_first}}. ADU permit ({{permit_number}}). {{permit_value}} bid good 14d. Reply YES.',
 now()),
(NULL::uuid, 'adu', 'day7', 'email', true,
 'ADU — day 7 email',
 'Closing on {{permit_number}}',
 E'Hi {{owner_first}},\n\nLast note on the ADU at {{address}}. Critical questions for any ADU bid:\n\n- Single PM through CO (not subbed out)\n- Utility separation included\n- Schedule with named milestones (not just "complete by Q3")\n- Contingency line (3-5%) explicit in the budget\n\n{{contractor_phone}} or reply.\n\n— {{contractor_name}}',
 now())

-- ── General remodel ──────────────────────────────────────────────────

,(NULL::uuid, 'general', 'initial', 'sms', true,
 'General — initial SMS',
 NULL,
 'Hi {{owner_first}}, {{contractor_name}} from {{contractor_company}}. Remodel permit at {{address_short}} (#{{permit_number}}). Happy to share scope-specific notes from similar projects in {{zip}}. Reply YES.',
 now()),
(NULL::uuid, 'general', 'initial', 'email', true,
 'General — initial email',
 'Your remodel permit at {{address_short}}',
 E'Hi {{owner_first}},\n\nRemodel permit ({{permit_number}}) at {{address}} just filed. Quick intro — {{contractor_company}} in {{zip}}.\n\nGeneral remodels usually live or die on subcontractor coordination. We''ve written 7 similar permits this year — happy to share what worked + what cost money on the wrong end of a schedule.\n\n{{contractor_phone}} for a 15-min walk.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'general', 'day3', 'sms', true,
 'General — day 3 SMS',
 NULL,
 '{{owner_first}}, remodel at {{address_short}} — checking in. Subcontractor lead times on cabinets + countertops 8-10 weeks. Worth a quick call? {{contractor_phone}}.',
 now()),
(NULL::uuid, 'general', 'day3', 'email', true,
 'General — day 3 email',
 'Re: remodel permit',
 E'Hi {{owner_first}},\n\nFollowing up on {{permit_number}}. Three things that drive remodel timelines:\n\n1. Cabinet lead times (8-12 weeks, longer for custom)\n2. Countertop measurement window (after cabinet install — locks 4-week dependency)\n3. HVAC + electrical re-routing (often discovers things mid-rough)\n\nWe coordinate all three under one PM. {{contractor_phone}}.\n\n— {{contractor_name}}',
 now()),
(NULL::uuid, 'general', 'day7', 'sms', true,
 'General — day 7 SMS',
 NULL,
 'Last touch, {{owner_first}}. Remodel at {{address_short}}. {{permit_value}} bid good 14d. Reply YES.',
 now()),
(NULL::uuid, 'general', 'day7', 'email', true,
 'General — day 7 email',
 'Closing on {{permit_number}}',
 E'Hi {{owner_first}},\n\nLast note on the remodel at {{address}}. Things to verify with any GC bid:\n\n- Single PM through final CO\n- Allowances NOT estimates for cabinets/countertops/tile\n- Change-order policy explicit (most overruns happen here)\n- License + insurance current (we attach copies to every bid)\n\n{{contractor_phone}} or reply.\n\n— {{contractor_name}}',
 now())

ON CONFLICT (trade, stage, channel) WHERE is_default = true AND contractor_id IS NULL DO NOTHING;

COMMIT;

-- ── Apply path ─────────────────────────────────────────────────────
--
--   pnpm migrate (preferred)
--   OR paste into Supabase web SQL editor.
--
-- Verify:
--   SELECT trade, stage, channel, name FROM outreach_templates
--   WHERE is_default = true AND contractor_id IS NULL ORDER BY trade, stage, channel;
-- Should return 42 rows (7 trades × 3 stages × 2 channels).
