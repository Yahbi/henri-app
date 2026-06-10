-- ─────────────────────────────────────────────────────────────────────
-- 00104 · Discovery cursor state for the nationwide source-discovery loop.
--
-- `/api/cron/discover-sources` walks the national open-data catalog
-- (Socrata Discovery API + ArcGIS Hub API) one page per run, auto-detects
-- field mappings, and inserts new permit datasets into permit_sources.
-- This table holds the per-catalog pagination cursor so the loop resumes
-- across runs and, on reaching the end of a catalog, re-sweeps from the
-- top — so newly-published municipal datasets are picked up forever
-- ("doesn't stop until nationwide", then keeps watching).
--
-- Service-role-write only (RLS-on, no policy) — matches the sidecar
-- pattern. Idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.discovery_state (
  catalog          text PRIMARY KEY,            -- 'socrata' | 'arcgis'
  cursor_offset    integer NOT NULL DEFAULT 0,  -- next page offset/start
  result_set_size  integer,                     -- last-known total in catalog
  sweeps_completed integer NOT NULL DEFAULT 0,  -- full passes through the catalog
  candidates_seen  integer NOT NULL DEFAULT 0,  -- cumulative items examined
  inserted_total   integer NOT NULL DEFAULT 0,  -- cumulative sources added
  last_run_at      timestamptz,
  last_summary     jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.discovery_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovery_state FROM PUBLIC, anon, authenticated;

INSERT INTO public.discovery_state (catalog) VALUES ('socrata'), ('arcgis')
ON CONFLICT (catalog) DO NOTHING;

COMMIT;
