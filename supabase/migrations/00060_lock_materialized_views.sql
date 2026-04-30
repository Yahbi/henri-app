-- 00060_lock_materialized_views.sql
-- 2026-04-29 audit follow-up: revoke materialized-view SELECT from
-- anon/authenticated for views that the app doesn't read via PostgREST.
--
-- contractor_leaderboard is REFRESHED by /api/cron/zip-demand via the
-- service-role admin client, but no app route SELECTs from it directly.
-- (Verified by grep over src/ on 2026-04-29 — only the refresh call
-- exists.) The Supabase advisor flags it because materialized views
-- in `public` are auto-exposed via the Data API.
--
-- Lock it to service-role only. If a future contractor-leaderboard UI
-- needs it, expose via a server-side API route (not direct PostgREST).
--
-- Idempotency: REVOKE on a no-grant is a no-op.

BEGIN;

REVOKE SELECT ON public.contractor_leaderboard FROM anon, authenticated;

COMMENT ON MATERIALIZED VIEW public.contractor_leaderboard IS
  'Refreshed by /api/cron/zip-demand. Service-role read only — front-end
  surfaces should expose curated rows via an API route, not direct
  PostgREST. Lockdown 2026-04-29 (audit migration 00060).';

COMMIT;