-- 00096_stage_history_backfill.sql
--
-- Audit fix — `stage_history` is empty for every lead that already
-- had a non-null `opportunity_stage` BEFORE migration 00092's trigger
-- landed. The trigger fires on UPDATE OF opportunity_stage, but the
-- ~95k leads that were stamped by the Sprint Z task 1 backfill
-- predate the trigger → 0 history rows for them → the IntentChip's
-- "Hot for X days" duration never renders.
--
-- One-shot fix: synthesize an initial `stage_history` row for every
-- lead that currently has a non-null `opportunity_stage` and no
-- existing history. Use the lead's `updated_at` as the
-- best-available approximation of "when this stage was set" (the
-- backfill script bumped updated_at on every row it stamped).
--
-- Idempotent — the WHERE NOT EXISTS guard means re-running the
-- migration is a no-op (won't double-insert).
--
-- Safe under any DB load — runs as a single INSERT … SELECT … with
-- a NOT EXISTS subquery; PostgreSQL plans this efficiently using
-- the leads_stage_idx + stage_history(lead_id) lookup.

BEGIN;

INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
SELECT
  l.id,
  NULL,                       -- no prior stage to record (this IS the initial stamp)
  l.opportunity_stage,
  COALESCE(l.updated_at, l.created_at, NOW()),
  'backfill'
FROM public.leads l
WHERE l.opportunity_stage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id
  );

COMMIT;

-- Verify:
--   SELECT
--     COUNT(*) FILTER (WHERE opportunity_stage IS NOT NULL) AS leads_stamped,
--     (SELECT COUNT(*) FROM stage_history) AS history_rows
--   FROM public.leads;
--   -- history_rows should be ≥ leads_stamped
