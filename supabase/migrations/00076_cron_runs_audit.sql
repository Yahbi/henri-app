-- 00076_cron_runs_audit.sql
-- Adds a per-execution audit log for sidecar-data cron routes. The
-- existing data-health view already shows "table populated yes/no",
-- but a cron that fires, errors silently, and inserts 0 rows looks
-- identical to a cron that simply hasn't fired yet. This table
-- captures every run so silent-failures surface immediately.
--
-- One row per cron invocation:
--   cron_path        e.g. 'swdi-events'
--   started_at / finished_at
--   duration_ms
--   status           'ok' | 'error' | 'partial'
--   pulled / inserted   pass-through counts from the cron's response
--   summary          jsonb with whatever the route returns
--   error            text (truncated stack trace on failure)
--   trigger          'cron' | 'manual' (admin-trigger button vs Vercel)
--
-- Service-role-write only (cron handlers + admin trigger).
-- RLS-on, no policies — accepted-risk pattern.
--
-- Idempotent + additive.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_runs (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_path     text NOT NULL,                              -- 'swdi-events', 'fema-nri', etc.
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   integer,
  status        text NOT NULL DEFAULT 'ok'                  -- 'ok' | 'error' | 'partial'
                CHECK (status IN ('ok', 'error', 'partial')),
  pulled        integer,                                    -- rows fetched upstream
  inserted      integer,                                    -- rows actually upserted
  summary       jsonb,                                      -- raw upstream JSON for forensics
  error         text,                                       -- error message (truncated 2KB)
  trigger       text NOT NULL DEFAULT 'cron'                -- 'cron' | 'manual'
                CHECK (trigger IN ('cron', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_path_recent
  ON public.cron_runs (cron_path, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status_recent
  ON public.cron_runs (status, started_at DESC)
  WHERE status != 'ok';
CREATE INDEX IF NOT EXISTS idx_cron_runs_recent
  ON public.cron_runs (started_at DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verify:
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='cron_runs';
-- Should return 1.
