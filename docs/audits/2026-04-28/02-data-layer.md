# 02 — Data Layer

## TL;DR

Migrations are idempotent and RLS-clean. **8 of the 9 prior-pending migrations have landed** since 2026-04-26 (00041–00047, 00050, 00051). Two remain pending — 00052 (provenance metadata on `permit_sources`) and 00053 (`permit_source_zips` linkage table). Both are idempotent and on the user's clipboard. The data layer's biggest WATCH is the **migration numbering gap at 00048-00049** — those numbers are absent and no CHANGELOG explains the skip.

## Score

**WATCH** — applying the 2 pending migrations + clarifying the numbering gap closes most of the remaining concerns.

## Migration status

| # | File | Status | Notes |
|---|---|---|---|
| 00031 | `wedge_trust.sql` | Applied | Exclusivity locks + watchers + permit_events (wedge bullets #1, #6) |
| 00039 | `contact_provenance.sql` | Applied | contact_source / contact_confidence / contact_extracted_at |
| 00041 | `voter_files.sql` | Applied | voter_fl/nc/oh tables |
| 00042 | `ppp_loans.sql` | Applied | PPP loan enrichment table |
| 00043 | `enrich_indexes.sql` | Applied | Partial indexes (year_built / owner / phone NULL paths) |
| 00044 | `leads_enrichment_columns.sql` | Applied | employer / occupation / business_* / license_* / naics_code |
| 00045 | `cross_trade_suggestions.sql` | Applied | Phase 1.2 jsonb column |
| 00046 | `referral_credits.sql` | Applied | Phase 1.4 idempotency log |
| 00047 | `seed_outreach_templates.sql` | Applied | 50 templates seeded |
| **00048** | **(missing)** | **n/a** | **Numbering gap — no CHANGELOG explanation** |
| **00049** | **(missing)** | **n/a** | **Numbering gap — no CHANGELOG explanation** |
| 00050 | `storm_events.sql` | Applied | NOAA Storm Events ingest |
| 00051 | `last_enriched_at.sql` | Applied | leads.last_enriched_at + index |
| **00052** | **`permit_source_provenance.sql`** | **PENDING** | discovered_via / field_mapping_status / priority / imported_at / notes columns on permit_sources |
| **00053** | **`permit_source_zip_coverage.sql`** | **PENDING (table exists, never populated)** | many-to-many `permit_source_zips(source_key, zip, granularity)` for zip→source linkage |

## Findings

### F1. ISSUE — Migrations 00052 + 00053 still pending
**Files**: `supabase/migrations/00052_permit_source_provenance.sql` (idempotent, 1-2 min apply), `supabase/migrations/00053_permit_source_zip_coverage.sql` (idempotent, 1-2 min apply)
**Severity**: High
**Why it matters**: 9 importer scripts in this session graceful-degraded their upserts because `discovered_via` / `field_mapping_status` columns don't exist (PGRST204 schema-cache-miss → strip provenance → retry). The metadata that distinguishes "this row came from US_LIVE_PERMITS_MASTER" from "this row came from auto-discovery" is silently lost. CLAUDE.md "feature-flags before migrations" pattern requires that the migrations land before the next refresh of importer state.

Migration 00053 is a partial state: the table EXISTS (audit confirmed via direct probe) but `permit_source_zips` is empty (0 rows). The JSON importer's Phase 2 detection logic was patched this session to distinguish PGRST205 (stale cache) from 42P01 (real missing table), so re-running `pnpm import:master-json` will populate it once the user pastes the migration and the cache refreshes.
**Recommended fix**:
1. User pastes the bundle at https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new (already on clipboard).
2. Re-run `pnpm import:master-json` to populate `permit_source_zips` (Phase 2 streaming refactor lands ~33,250 ZIPs × N sources).
3. Re-run all 9 importer scripts to backfill provenance metadata (they're idempotent on `source_key`).

### F2. WATCH — Migration numbering gap at 00048 + 00049
**Files**: `supabase/migrations/` (no 00048 or 00049 files)
**Severity**: Low
**Why it matters**: Monotonic numbering is a contract. Gaps suggest dropped work or manual overrides. Future migrations (00054+) will reference "the migration after 00047" — if 00048/00049 turn out to be lost work, the codebase has silent missing schema.
**Recommended fix**: Audit `git log -- supabase/migrations/` for any deleted 00048/00049 file. If they were intentionally squashed, add a comment to `00050_storm_events.sql` explaining: `-- Note: 00048-00049 squashed/skipped, see commit X.` If they were lost, recover and renumber.

### F3. HEALTHY — Idempotency pattern holds across all 51 migrations
**Files**: `supabase/migrations/*.sql`
**Why it matters**: Every migration uses `IF NOT EXISTS` (374 occurrences) for tables/columns/indexes, and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for enum types and policies. Re-runs are safe. CLAUDE.md mandates this.
**Status**: No regressions; pattern is universal.

### F4. HEALTHY — RLS pattern is canonical
**Files**: `supabase/migrations/00053_permit_source_zip_coverage.sql:42-57` (new this session)
**Why it matters**: New table enables RLS, grants `SELECT TO authenticated USING (true)` (reference data, not lead-sensitive), defers writes to service role. Matches the canonical pattern from `permits`, `leads`, `territories`.
**Status**: No action.

### F5. HEALTHY — `last_enriched_at` (00051) is wired to enrichment cron
**Files**: `src/app/api/cron/re-enrich/route.ts`, `supabase/migrations/00051_last_enriched_at.sql`
**Why it matters**: B7 fix earlier this session routed `home_sqft`/`lot_sqft` through `assign()` helper so updated_at only churns when a real field actually changed — no more nightly false-update on every previously-enriched row.
**Status**: Confirmed in re-enrich cron logic.

### F6. WATCH — `dashboard/page.tsx` has 5 unsafe joined-relation casts
**File**: `src/app/(dashboard)/dashboard/page.tsx:81-88` (mapLead function)
**Severity**: Medium
**Why it matters**: Lead type doesn't declare the `permits` join shape returned by `useLeads`. Code casts via `as unknown as Record<string, unknown>` 5 times to read `permitUuid`, `permitApplicantName`, `permitContractorName`, etc. Fragile to schema drift.
**Recommended fix**: Run `mcp__supabase__generate_typescript_types` to create `src/types/database.ts`. Refactor `mapLead()` to use the typed accessor. Closes a chunk of finding [03-types-and-hooks.md C1](./03-types-and-hooks.md).

### F7. HEALTHY — Importer scripts respect feature-flag-before-migration
**Files**: `scripts/import-desktop-catalogs.ts`, `scripts/import-perfected-csv.ts`, `scripts/import-master-json.ts`, `scripts/import-live-master.ts`, `scripts/import-dh3-*.ts`, `scripts/import-hd-*.ts`, `scripts/discover-sources.ts`
**Why it matters**: Each upserts with the rich provenance shape; on PGRST204 / 42703 / "schema cache" error it strips `discovered_via` / `field_mapping_status` / `priority` / `imported_at` / `notes` and retries. New session-added scripts all follow the pattern. The data lands either way; metadata is preserved when the migration is applied, dropped silently otherwise.
**Status**: Pattern is consistently applied across all 9 importers.

## Diff vs 2026-04-26

### Closed
- 5 of the 5 pending migrations (00040-00044) applied
- 00045-00047 + 00050-00051 added and applied
- `pnpm migrate` script wired (`scripts/apply-pending-migrations.ts` audits + emits bundle)
- B7 fix to re-enrich cron (true field change detection, no `updated_at` churn)

### Still open
- 00052 + 00053 pending (idempotent, 2-min paste) — the only blockers to full provenance/ZIP-linkage coverage
- 00048 + 00049 missing without explanation
- Auto-generated DB types still not started (`src/types/database.ts` does not exist yet)
