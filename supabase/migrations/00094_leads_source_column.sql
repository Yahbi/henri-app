-- 00094_leads_source_column.sql
--
-- Phase AA-3 (option A — parcel synthesis pre-intent leads).
--
-- Schema delta to support pre-intent leads synthesised from parcel
-- data, NOT permits:
--   1. Add `leads.source TEXT DEFAULT 'permit'` so the UI + analytics
--      can distinguish permit-derived leads from parcel-synthesised
--      ones. Existing rows are stamped 'permit' (the old behaviour);
--      new synthesis rows get 'parcel_synthesis'.
--   2. Add `leads.parcel_sidecar_uid uuid` — optional FK-shaped
--      pointer to the `parcels_sidecar.sidecar_uid` row that drove
--      the synthesis. Lets the drawer surface "this lead was sourced
--      from <parcel record>" honestly. Not a hard FK because the
--      parcels_sidecar table can be re-built from upstream data
--      without breaking lead linkage.
--   3. Add a partial unique index on (contractor_id, parcel_sidecar_uid)
--      WHERE parcel_sidecar_uid IS NOT NULL — so the synthesis cron
--      can upsert without creating duplicates per (contractor, parcel)
--      pair. Permit-derived leads still dedupe via the existing
--      (permit_id, contractor_id) constraint and aren't affected.
--
-- Idempotent + additive. Defaults preserve existing-row behaviour.

BEGIN;

-- ─── 1. source column ────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'permit';

-- Allowed values (validated in code, not via CHECK so future kinds
-- don't require a migration to land):
--   'permit'             — permit-derived (default; the score cron path)
--   'parcel_synthesis'   — synthesised from parcels_sidecar (Phase AA-3)
--   'event_trigger'      — created from a code_violation / disaster /
--                          REO event lookup (future)
--   'manual'             — contractor manually added via AddLeadDialog

-- ─── 2. parcel_sidecar_uid pointer ───────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS parcel_sidecar_uid UUID;

-- ─── 3. partial uniqueness for synthesis upserts ─────────────────────
-- Allows multiple leads per (contractor, parcel) historically (the FK is
-- nullable for permit-derived leads), but enforces "one parcel-derived
-- lead per (contractor, parcel)" so the weekly synthesis cron can
-- safely upsert without duplicate rows accumulating.
CREATE UNIQUE INDEX IF NOT EXISTS leads_contractor_parcel_uq
  ON public.leads (contractor_id, parcel_sidecar_uid)
  WHERE parcel_sidecar_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_source_idx
  ON public.leads (source)
  WHERE source <> 'permit';

COMMIT;

-- Verify:
--   SELECT source, COUNT(*) FROM public.leads GROUP BY source;
--   -- should return: permit | <existing count>
