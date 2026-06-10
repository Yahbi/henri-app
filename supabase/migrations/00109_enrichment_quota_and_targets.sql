-- ─────────────────────────────────────────────────────────────────────
-- 00109 · Territory-scoped enrichment: quota tracking + target metros
--
-- 2026-06-10 architecture: paid/quota-bound enrichment follows CLAIMED
-- territories and score rank — the corpus at large only ever gets FREE
-- in-DB enrichment. Two config/state tables support that:
--
--   enrichment_quota_usage  — per-source spend against a monthly/daily
--     budget, so low-quota keyed sources (Numverify 100/mo, Hunter 25/mo)
--     are spent only on priority-1 (paid-territory) leads and skip
--     gracefully once exhausted.
--   enrichment_target_metros — operator-curated ZIPs being pitched; their
--     top-scored leads get high-volume FREE APIs (OpenCorporates, FEC,
--     Google credit) on top of the free in-DB stack.
--
-- Service-role-write only (RLS-on, no policy) — sidecar pattern.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.enrichment_quota_usage (
  source     text NOT NULL,
  period     text NOT NULL,        -- 'YYYY-MM' (monthly) or 'YYYY-MM-DD' (daily)
  used       integer NOT NULL DEFAULT 0,
  budget     integer NOT NULL,     -- snapshot of the configured budget
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, period)
);

CREATE TABLE IF NOT EXISTS public.enrichment_target_metros (
  zip        text PRIMARY KEY,
  label      text,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enrichment_quota_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_target_metros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrichment_quota_usage   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.enrichment_target_metros FROM PUBLIC, anon, authenticated;

-- Atomic spend recorder: increments used (creating the period row on
-- first spend), returns the new used count. SECURITY DEFINER, service-role.
CREATE OR REPLACE FUNCTION public.record_enrichment_spend(
  p_source text,
  p_period text,
  p_budget integer,
  p_count  integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_used integer;
BEGIN
  INSERT INTO public.enrichment_quota_usage (source, period, used, budget, updated_at)
  VALUES (p_source, p_period, p_count, p_budget, now())
  ON CONFLICT (source, period) DO UPDATE
    SET used = enrichment_quota_usage.used + p_count,
        budget = EXCLUDED.budget,
        updated_at = now()
  RETURNING used INTO v_used;
  RETURN v_used;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_enrichment_spend(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_enrichment_spend(text, text, integer, integer) TO service_role;

COMMIT;
