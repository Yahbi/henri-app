-- 00091_stage_outreach_templates.sql
--
-- Module 12 of the Phase Z sprint (plan §Z.15.6).
--
-- Adds 5 stage-specific outreach templates to the global library
-- (contractor_id IS NULL, is_library=true). Each is keyed to a
-- value from the Module 1 `opportunity_stage` enum so the outreach
-- picker can filter templates by the lead's current stage.
--
-- Stages targeted:
--   1. permit_filed_no_contractor  → direct-hire pitch (homeowner is hiring NOW)
--   2. permit_filed_with_contractor → subcontractor opportunity (GC is named)
--   3. stalled / expired           → expediter opportunity (permit needs help)
--   4. maintenance_upsell          → completed-project follow-up
--   5. pre_intent                  → pre-permit outreach (signals only, no permit yet)
--
-- Token usage matches the resolver in src/lib/outreach/tokens.ts:
--   {{owner_first}} {{address_short}} {{permit_number}} {{permit_scope}}
--   {{days_ago}} {{contractor_name}} {{contractor_company}} {{contractor_phone}}
--
-- Idempotent — uses WHERE NOT EXISTS guard on (name, contractor_id IS NULL).
--
-- Note: there is no `opportunity_stage` enum in Postgres (deliberately —
-- we use text columns + allowed-value lists in code so the values can
-- iterate without migrations). The `stage` column on outreach_templates
-- is also a free text column. We populate it with the canonical stage
-- name so the picker can filter by `stage = 'permit_filed_no_contractor'`
-- etc.

BEGIN;

INSERT INTO public.outreach_templates
  (contractor_id, name, subject, body, channel, trade, is_library, stage, is_default)
SELECT * FROM (VALUES

  -- ── 1. permit_filed_no_contractor — direct hire pitch ────────────────
  (
    NULL::uuid,
    'Permit filed, no contractor — direct hire',
    'About your permit at {{address_short}}',
    E'Hi {{owner_first}},\n\nI saw your permit #{{permit_number}} for {{address_short}} was filed {{days_ago}} days ago — scope reads: {{permit_scope}}.\n\nNo contractor is listed on the filing yet, which usually means you''re still picking who to hire. {{contractor_company}} is a licensed {{trade}} contractor working in your area, and we typically book this kind of project into the next 30 days.\n\nIf you haven''t locked someone in, I''d like to bring over a quick walk-through plus a fixed-price bid — no pitch, just numbers. 20 minutes on-site and you''ll know what a fair price looks like.\n\nReply here or text {{contractor_phone}} and I''ll get you on the calendar.\n\n— {{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'permit_filed_no_contractor',
    false
  ),

  -- ── 2. permit_filed_with_contractor — subcontractor pitch ─────────────
  (
    NULL::uuid,
    'GC named on permit — subcontractor intro',
    'Sub-trade availability for {{address_short}}',
    E'Hi {{owner_first}},\n\nI noticed permit #{{permit_number}} at {{address_short}} ({{permit_scope}}) was filed with a general contractor already on the job. Most projects this size end up needing additional sub-trades once scope clarifies.\n\n{{contractor_company}} runs {{trade}} sub-work for several GCs in your area — schedules tighten 2-3 weeks after the GC starts, so this is the ideal window to lock in a sub.\n\nIf your GC hasn''t named one yet for {{trade}}, I''d be happy to send over our crew availability + sub-rate sheet. We don''t change-order; what we quote is what you pay.\n\n— {{contractor_name}}\n{{contractor_company}}\n{{contractor_phone}}',
    'email',
    NULL::text,
    true,
    'permit_filed_with_contractor',
    false
  ),

  -- ── 3. stalled / expired — expediter opportunity ───────────────────────
  (
    NULL::uuid,
    'Stalled permit — expediter outreach',
    'Quick note about permit {{permit_number}}',
    E'Hi {{owner_first}},\n\nYour permit #{{permit_number}} at {{address_short}} is showing in stalled / correction-required status, and the original filing is now {{days_ago}} days old. That''s the most common reason a remodel slips 4-6 months past schedule.\n\nWe specialize in unblocking stalled permits — usually it''s a plan-check correction, a missed inspection, or a discipline (electrical / plumbing) that needs to be added to the existing scope. We can re-engage the building department directly.\n\nNo retainer, just a flat fee once the permit is back on track. If that''s useful, reply here or text {{contractor_phone}}.\n\n— {{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'stalled',
    false
  ),

  -- ── 4. maintenance_upsell — completed-project follow-up ───────────────
  (
    NULL::uuid,
    'Completed permit — maintenance / replacement window',
    '{{address_short}} — checking in on your {{trade}} system',
    E'Hi {{owner_first}},\n\nYour {{trade}} permit at {{address_short}} ({{permit_scope}}) wrapped up some time ago, and we''ve hit the window where most homeowners start thinking about preventive maintenance or replacement parts before something fails.\n\n{{contractor_company}} runs a flat-fee inspection — we walk the system, document anything aging out, and send you a written report. No upsell pressure; you decide if anything needs attention now vs. later.\n\nIf that''s useful, reply here or text {{contractor_phone}}. We''re booking 2-3 weeks out.\n\n— {{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'maintenance_upsell',
    false
  ),

  -- ── 5. pre_intent — pre-permit outreach ────────────────────────────────
  (
    NULL::uuid,
    'Pre-intent — neighborhood {{trade}} introduction',
    'A quick {{trade}} introduction — {{city}}',
    E'Hi {{owner_first}},\n\nNo permit on file yet — but a few signals at {{address_short}} suggest you may be thinking about a {{trade}} project sometime in the next year (property age, recent activity in your ZIP, or both).\n\n{{contractor_company}} is a licensed {{trade}} contractor working in your neighborhood. We do free pre-project walk-throughs — useful when you''re still gathering information and want a contractor''s read on what scope makes sense vs. what doesn''t.\n\nNo pitch, no follow-up calls. If the timing isn''t right, no problem at all.\n\nReply here or text {{contractor_phone}} if you''d like a 20-minute on-site visit.\n\n— {{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'pre_intent',
    false
  )

) AS new_templates(contractor_id, name, subject, body, channel, trade, is_library, stage, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM public.outreach_templates ot
  WHERE ot.is_library = true
    AND ot.contractor_id IS NULL
    AND ot.name = new_templates.name
);

COMMIT;

-- Verify:
--   SELECT name, stage FROM public.outreach_templates
--   WHERE is_library = true
--     AND contractor_id IS NULL
--     AND stage IN (
--       'permit_filed_no_contractor',
--       'permit_filed_with_contractor',
--       'stalled',
--       'maintenance_upsell',
--       'pre_intent'
--     );
