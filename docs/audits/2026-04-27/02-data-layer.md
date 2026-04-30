# 02 — Data layer

## TL;DR

Migrations are organized numerically; RLS policies are strict (read: contractor_id match, write: service_role only); enrichment pipeline gracefully handles partial-schema deploys. The critical blocker is **11 pending migrations** (00031, 00039, 00041–00047, 00050, 00051) — same as baseline plus the new 00051 added yesterday. The bundle is at `supabase/_pending-bundle.sql` (1,204 lines) including the `exec_sql()` bootstrap so future `pnpm migrate` runs auto-apply via Path A. Verified live state: permits = ~932k rows, leads = ~133.7k rows, enrichment fill rates: owner_name 27%, phone 1%, email 0%. The `permits.estimated_value` column is BIGINT (decimals in source data must be rounded; bug seen + fixed in `import-permit-archive.ts` today).

## Score

**WATCH** — bundle is mechanical to apply (5 minutes); blocks burst-enrich indexes (00043), provenance writes (00039), exclusivity locks (00031), and last_enriched_at on the new re-enrich cron (00051).

## Inventory

| Aspect | Count / Note |
|---|---|
| Applied migrations | 30 (00001–00030) plus partial gaps |
| Pending migrations | 11 (00031, 00039, 00041–00047, 00050, 00051) |
| Migration bundle | `supabase/_pending-bundle.sql` 1,204 lines, includes `exec_sql()` RPC bootstrap |
| Permits table columns | 27 (verified via `_probe-permits-schema.ts`) |
| Permits unique constraint | `uq_permits_source` on (source_id, permit_number) — confirmed via probe |
| `permit_type` enum | addition, commercial, demolition, new_construction, other, renovation, repair, residential |
| `source_type` enum | accela, arcgis, ckan, socrata |
| `status` enum | expired, final, issued, revoked, submitted (NOT NULL) |
| Tables with RLS | 35+ |
| Hand-written types | 100% (`src/types/lead.ts` 149 LOC); no `database.ts` from `supabase gen types` |

## Findings

### F1 — 11 pending migrations remain unapplied

- **Severity**: HIGH
- **Files**: `supabase/migrations/00031`, `00039`, `00041–00047`, `00050`, `00051` + `supabase/_pending-bundle.sql`
- **Blocker for**: `/api/cron/permits` insert (currently fails on `contact_confidence` column missing), wedge bullets #1 (exclusivity_locks) and #6 (watchers), the new re-enrich cron (00051), provenance UI (00039), 42-template seed (00047), storm context (00050).
- **Recommendation**: Paste `_pending-bundle.sql` into Supabase SQL editor at `https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new` → Run. Verify with `npx tsx scripts/_session-data-audit.ts` showing all "Recent migration probes" green.

### F2 — Migration numbering gap: 00038, 00048, 00049 are missing files

- **Severity**: MEDIUM
- **Why**: A numbering gap can indicate lost work, failed squash, or manual delete.
- **Recommendation**: `git log --all --oneline -- supabase/migrations/` to see whether they were committed and removed. If never committed, document why in a one-line comment.

### F3 — `permits.estimated_value` is BIGINT; archive ships decimals

- **Severity**: MEDIUM (NEW today)
- **File**: `scripts/import-permit-archive.ts` (fix shipped same session)
- **Why**: `invalid input syntax for type bigint: "338098.01"` failures during bulk import. Live schema is BIGINT; raw archive has values like `338098.01`. Fix added: `Math.round()` + reject negatives and >1e10 outliers.
- **Recommendation**: Document on the column in a future migration: `COMMENT ON COLUMN permits.estimated_value IS 'USD whole dollars; decimals rounded at insert.'`

### F4 — `_pending-bundle.sql` ready to execute (positive)

- **Severity**: HEALTHY
- **File**: `supabase/_pending-bundle.sql` (1,204 lines)
- **Status**: Includes `exec_sql()` bootstrap (creates a service_role-only function for future Path A auto-apply). Idempotent — every migration uses `IF NOT EXISTS` and `CREATE OR REPLACE`.

### F5 — RLS policies are strict (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Read-policies enforce contractor_id; write-policies are service_role-only. No SELECT-only gaps found.

### F6 — Hand-written DB types drift from schema

- **Severity**: MEDIUM
- **File**: `src/types/lead.ts` (149 LOC, hand-written)
- **Why**: 53 `as unknown as` casts (see 03 F1) traceable to types that don't reflect 00041/00042/00044 columns.
- **Recommendation**: `pnpm supabase gen types --lang=typescript > src/types/database.ts` after migrations apply; refactor `mapLead()`.

### F7 — `/api/cron/re-enrich` graceful-degrades when 00051 missing

- **Severity**: HEALTHY
- **File**: `src/app/api/cron/re-enrich/route.ts:117-126`
- **Status**: Returns `{success: true, skipped_migration_pending: true}` on the "column does not exist" error. Verified live yesterday.

### F8 — Type casting count: 53 `as unknown as`, 1 `Record<string,unknown>`

- **Severity**: MEDIUM (tied to F6)
- **Status**: Most stem from drift; 1 (`supabase/client.ts:23`) is a deliberate fallback mock.

### F9 — `zip_source_map` migration (00052) doesn't exist yet

- **Severity**: LOW
- **Why**: Referenced in `docs/data-integration-plan.md` for the Massive_US_Permit_Mapping import; not yet authored.
- **Recommendation**: Create when the ZIP-source feature is scoped.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F1 | Apply pending bundle | 5 min | Yes |
| F2 | Document missing 00038/00048/00049 | 15 min | No |
| F6 | Auto-generate DB types | 2-3 h | No (after F1) |
| F9 | Author 00052_zip_source_map | TBD | No |
