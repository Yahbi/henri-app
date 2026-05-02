-- 00078_disaster_context_outreach_templates.sql
-- Wave 2.C of the data-acquisition plan — closes wedge contract
-- bullet #4 ("outreach is permit-specific") for the disaster
-- context tokens shipped in commit 278868e.
--
-- Adds 4 starter templates to the global library (contractor_id IS
-- NULL, is_library=true) that contractors can clone + customize:
--
--   1. Post-storm restoration outreach
--   2. NFIP flood-claim history check-in
--   3. Federal disaster declaration follow-up
--   4. Mechanic-lien-aware payment-terms check-in
--
-- Each uses one or more of the 7 new disaster-context tokens
-- ({{nfip_claim_count}}, {{nri_risk_tier}}, {{recent_disaster_id}},
-- {{recent_disaster_title}}, {{storm_count_30d}}, {{lien_count_90d}})
-- so contractors can immediately benefit from the Wave 2 sidecar
-- data without writing tokens themselves.
--
-- Idempotent — uses WHERE NOT EXISTS guard on (name, contractor_id IS NULL).

BEGIN;

INSERT INTO public.outreach_templates
  (contractor_id, name, subject, body, channel, trade, is_library, stage, is_default)
SELECT * FROM (VALUES
  (
    NULL::uuid,
    'Post-storm restoration outreach',
    'After the storm — quick {{trade}} check-in for {{address_short}}',
    E'Hi {{owner_first}},\n\nI saw {{storm_count_30d}} severe-weather events near {{address_short}} in the last 30 days, and your area is in a {{nri_risk_tier}} disaster-risk tier.\n\nIf the storms left any damage you''re thinking about — roof, siding, water intrusion — I''d be glad to do a free walk-through and let you know what''s urgent vs cosmetic. No pressure either way.\n\nBest,\n{{contractor_name}}\n{{contractor_company}}\n{{contractor_phone}}',
    'email',
    NULL::text,
    true,
    'first_touch',
    false
  ),
  (
    NULL::uuid,
    'NFIP flood-claim history check-in',
    '{{address_short}} flood-claim follow-up',
    E'Hi {{owner_first}},\n\nYour ZIP has had {{nfip_claim_count}} NFIP flood claims on file, and I noticed your recent permit at {{address_short}} ({{permit_number}}) is for {{permit_scope}}.\n\nIf flood damage is part of what triggered this work — or you''re thinking about preventive waterproofing / sump-pump / drainage — I focus on this exact type of project and would love a quick chat about scope.\n\n{{contractor_name}}\n{{contractor_company}}\n{{contractor_phone}}',
    'email',
    NULL::text,
    true,
    'first_touch',
    false
  ),
  (
    NULL::uuid,
    'Federal disaster declaration follow-up',
    'After {{recent_disaster_id}} — checking in on {{address_short}}',
    E'Hi {{owner_first}},\n\nI saw your recent permit at {{address_short}} (filed {{days_ago}} days ago for {{permit_scope}}). Given your area was under {{recent_disaster_title}} ({{recent_disaster_id}}), I wanted to make sure you have a contractor lined up for any storm-related work.\n\nFEMA IA registrations are still being processed for affected homeowners — happy to walk through what''s typically covered if that''s relevant.\n\n{{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'first_touch',
    false
  ),
  (
    NULL::uuid,
    'Mechanic-lien-aware payment terms check-in',
    'Re: {{permit_number}} — payment terms question',
    E'Hi {{owner_first}},\n\nQuick note about your project at {{address_short}} ({{permit_scope}}). I''ve been seeing more contractors filing mechanic''s liens in your area lately ({{lien_count_90d}} in the last 90 days), so before we start any work I want to be transparent about my payment process: I quote everything up front, take 25% on contract signing, and the balance only when you sign off on the work.\n\nNo surprises, no liens, no awkward conversations. Happy to send the formal estimate if you''d like.\n\n{{contractor_name}}\n{{contractor_company}}',
    'email',
    NULL::text,
    true,
    'first_touch',
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
--   SELECT name FROM outreach_templates
--   WHERE is_library = true AND contractor_id IS NULL
--     AND name LIKE '%storm%'
--      OR name LIKE '%flood%'
--      OR name LIKE '%disaster%'
--      OR name LIKE '%lien%';
