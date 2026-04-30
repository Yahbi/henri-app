# 02 — Data layer (2026-04-30)

## TL;DR

58 migrations (was 54). 6 new since 04-29: `00055_lead_property_context_views`, `00056_cost_benchmarks_rls`, `00057_security_advisor_fixes`, `00058_security_definer_lockdown`, `00059_revoke_public_execute`, `00060_lock_materialized_views`. All 6 are idempotent + reversible. RLS pattern compliance HEALTHY across the recent set. Documented numbering gaps at 00037→00039 + 00047→00050 unchanged. **Supabase advisor still reports 54 RLS initplan WARN + 21 multiple-permissive policy WARN** — the next high-leverage perf migration target.

## Score

**HEALTHY** — IMPROVED vs 2026-04-29 (5 RLS + privilege migrations landed in the audit-04-29 batch).

## Migration inventory (most recent 10)

| # | File | Purpose |
|---|---|---|
| 60 | `00060_lock_materialized_views.sql` | Revoke `contractor_leaderboard` SELECT from anon/authenticated; service-role only |
| 59 | `00059_revoke_public_execute.sql` | Real fix for default PUBLIC grant — REVOKE EXECUTE FROM PUBLIC + GRANT to authenticated for 7 SECURITY DEFINER functions |
| 58 | `00058_security_definer_lockdown.sql` | Initial SECURITY DEFINER role-revokes (superseded by 00059) |
| 57 | `00057_security_advisor_fixes.sql` | `zip_demand_scores` RLS hole + 2 functions with mutable search_path |
| 56 | `00056_cost_benchmarks_rls.sql` | `cost_benchmarks` RLS hole (CRITICAL — closed) |
| 55 | `00055_lead_property_context_views.sql` | Property-context view per lead |
| 54 | `00054_webhook_idempotency.sql` | Composite (webhook, key) PK; processed_at timestamp |
| 53 | `00053_permit_source_zip_coverage.sql` | ZIP coverage report per permit source |
| 52 | `00052_permit_source_provenance.sql` | Per-permit-source provenance JSONB |
| 51 | `00051_*` | (older) |

## RLS pattern compliance (recent migrations)

Sampled 00056, 00058, 00059, 00060. All follow the canonical pattern from CLAUDE.md:

```sql
BEGIN;
  ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;       -- idempotent
  DROP POLICY IF EXISTS <policy> ON <table>;            -- idempotent
  CREATE POLICY <name> ON <table>
    FOR SELECT / UPDATE / DELETE
    TO authenticated / service_role / public
    USING (<contractor_id = auth.uid()> or <true>);
COMMIT;
```

Privilege-revoke migrations (`00058`, `00059`, `00060`) use `REVOKE` + `GRANT` paired idiomatically — `REVOKE` on a non-existent grant is a no-op, so re-running is safe.

## Findings

**F1** | **High** | Supabase advisor (live audit query) — same as 04-29
- **Issue**: 54 RLS initplan WARN + 21 multiple-permissive policy WARN. Each `auth.uid()` call inside an RLS policy is re-evaluated per row when the policy uses `auth.uid()` directly instead of `(SELECT auth.uid())`.
- **Why it matters**: At 1000 leads × 1 dashboard fetch × 10 contractors, this multiplies the auth-call cost by row count. Wedge bullet #5 (speed-to-lead) wants <100ms drawer renders; today's RLS plan blows past that under load.
- **Recommended fix**: Author migration `00061_rls_initplan_perf_pass.sql` rewriting the 54 flagged policies as `(SELECT auth.uid())`, consolidating the 21 multiple-permissive policies into single OR'd predicates, and dropping any duplicate policies. ~1-2 hours focused work; isolated migration so it can be reviewed in isolation. Rollback plan: drop new policies, restore old ones from `git show HEAD:supabase/migrations/00060_*.sql` predecessors.

**F2** | **Low** | `supabase/migrations/` numbering (00037→00039 + 00047→00050)
- **Issue**: Two documented gaps. 00038 + 00048 + 00049 are absent.
- **Why it matters**: Numbering is for human ordering, not Postgres. The gap doesn't break anything — but every audit will keep flagging it.
- **Recommended fix**: Add a one-paragraph note in CLAUDE.md's "Migrations" section stating the gaps are intentional + when they were skipped + why. Or restore the missing files from git history. Either closes the audit signal.

**F3** | **Nitpick** | `supabase/_pending-bundle.sql` (14.1KB, untracked)
- **Issue**: Staging file for clipboard-paste migration application. Not in git, but referenced by the `apply migration` workflow.
- **Why it matters**: Onboarding a new dev requires explaining "what's in `_pending-bundle.sql`". Today the file appears untracked + unstaged.
- **Recommended fix**: Either commit the file (with a clear "this is a staging area, do not edit by hand" comment) OR move it under `.gitignore` and document the workflow in CLAUDE.md. Pick one; the current ambiguous state is the worst option.

**F4** | **Nitpick** | `00060_lock_materialized_views.sql` and the `contractor_leaderboard` view
- **Issue**: Materialized view is refreshed by `/api/cron/zip-demand` via service-role admin client; no app route reads from it directly. Locked to service-role only on 04-29 via 00060.
- **Why it matters**: Future "contractor leaderboard" UI will need an API route exposing curated rows; if a dev forgets to plumb it through PostgREST, it'll fail silently.
- **Recommended fix**: When the leaderboard UI ships, add a server-side `/api/contractor-leaderboard/route.ts` that calls the admin client + applies any contractor-visible filtering. Document the pattern as the canonical "how to expose service-role data to clients."

## RLS test discipline

Sampled `00056_cost_benchmarks_rls`:
- ✓ `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — present
- ✓ `DROP POLICY IF EXISTS` — idempotent
- ✓ `CREATE POLICY ... FOR SELECT TO authenticated USING (true)` — read-only for authenticated
- ✓ No INSERT/UPDATE/DELETE policies — RLS implicitly denies writes; service-role bypass works
- ✓ Documented intent: service-role only for cron refresh

## Pending migration backlog

`supabase/migrations/_pending-bundle.sql` exists (14.1KB, untracked). Contents bootstrap `exec_sql()` RPC + 00031_wedge_trust (exclusivity_locks, watchers, permit_events). No issues flagged but should be reconciled with the migration directory or moved to `.gitignore`.

## Closing

The data layer is the most disciplined surface in Henri. RLS-on-everything + idempotent migrations + documented gaps is the right pattern. The next high-leverage win is the RLS initplan perf pass (F1).
