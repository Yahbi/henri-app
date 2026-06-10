-- ─────────────────────────────────────────────────────────────────────
-- 00108 · get_lead_fill_rates() — enrichment observability
--
-- 2026-06-10 audit: enrichment fill rates (phone 1%, email 0%, etc.) were
-- invisible to the operator. This function returns the 6 headline fill
-- metrics + score ceiling in one table scan so the god-mode data-health
-- page can show progress as enrichment runs. SECURITY DEFINER + service-
-- role-only (the data-health route uses the admin client).
--
-- Single pass over leads (~270k rows, ~1-2s). The page caches 30s.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.get_lead_fill_rates()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
STABLE
AS $function$
  SELECT json_build_object(
    'total', count(*),
    'owner_name_pct', round(100.0 * count(*) FILTER (WHERE owner_name IS NOT NULL) / NULLIF(count(*),0), 1),
    'phone_pct',      round(100.0 * count(*) FILTER (WHERE phone IS NOT NULL) / NULLIF(count(*),0), 1),
    'email_pct',      round(100.0 * count(*) FILTER (WHERE email IS NOT NULL) / NULLIF(count(*),0), 1),
    'property_value_pct', round(100.0 * count(*) FILTER (WHERE property_value IS NOT NULL) / NULLIF(count(*),0), 1),
    'year_built_pct', round(100.0 * count(*) FILTER (WHERE year_built IS NOT NULL) / NULLIF(count(*),0), 1),
    'enriched_pct',   round(100.0 * count(*) FILTER (WHERE last_enriched_at IS NOT NULL) / NULLIF(count(*),0), 1),
    'score_max',      max(score),
    'hot_count',      count(*) FILTER (WHERE score >= 75)
  )
  FROM public.leads;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_lead_fill_rates() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_lead_fill_rates() TO service_role;

COMMIT;
