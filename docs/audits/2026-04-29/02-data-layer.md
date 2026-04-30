# 02 — Data layer

## TL;DR

54 migrations on disk (00001 → 00054 with a numbering gap at 00048–00049). Migration **00054_webhook_idempotency.sql** is NEW since 2026-04-28, applied, RLS-correct, and wired into `src/lib/webhooks/idempotency.ts`. Migrations 00045/46/47/50/51 (`cross_trade_suggestions`, `referral_credits`, `outreach_templates`, `storm_events`, `last_enriched_at`) all follow the CLAUDE.md schema rule. **00052/00053 remain pending** (idempotent on the user's clipboard from prior session). RLS holds across all new tables.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28 (which was WATCH because of pending 00052/00053; today's improvement is the cleanly-applied 00054).

## Findings

### F1. WATCH — Migration numbering gap 00048–00049
**Files**: `supabase/migrations/` — 00047 → 00050 with no 00048/00049
**Severity**: Low (cosmetic)
**Why it matters**: CLAUDE.md says "Location: `supabase/migrations/NNNNN_description.sql`. Monotonic numbering." Missing numbers don't break Postgres but they erode trust the next time someone tries to reproduce the schema from scratch. Either the files were drafted, abandoned, and renumbered without updating CLAUDE.md, or they're truly missing. The 2026-04-28 audit flagged this; no resolution in 24 hours.
**Recommended fix**: Either (a) restore 00048/00049 from git history if they exist there, OR (b) add a `supabase/migrations/_NUMBERING_GAP.md` (or update `CLAUDE.md`) documenting the intentional skip. ~15 min.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — Migration 00054_webhook_idempotency.sql is NEW + wired (closes prior #7)
**File**: `supabase/migrations/00054_webhook_idempotency.sql`
**Severity**: Low (positive finding)
**Why it matters**: New table `webhook_idempotency` with composite PK `(provider, event_id)`, RLS `SELECT TO authenticated USING (true)` for transparency, `processed_at` index for 90-day-pruning range deletes. Helper module at `src/lib/webhooks/idempotency.ts` (133 LOC) provides `wasProcessed(supabase, provider, event_id)` + `markProcessed(supabase, provider, event_id, opts)` with graceful-degrade if the table is missing (logs warn + returns false, treats every event as new). Imported by `src/app/api/webhooks/twilio/route.ts` and `src/app/api/webhooks/resend/route.ts`. Closes the 2026-04-28 audit's #7 priority.
**Recommended fix**: None. Migrate `src/app/api/webhooks/twilio-missed-call/route.ts` to also use the module — see [07-reliability.md F2](./07-reliability.md).
**Delta tag**: NEW (since 2026-04-28).

### F3. WATCH — Migrations 00052 + 00053 still pending application
**Files**:
- `supabase/migrations/00052_permit_source_provenance.sql`
- `supabase/migrations/00053_permit_source_zip_coverage.sql`

**Severity**: Medium
**Why it matters**: Both are idempotent and were on the user's clipboard yesterday for paste into the Supabase SQL editor. Neither has been applied per the 2026-04-28 audit. 00052 unblocks `discovered_via` / `field_mapping_status` columns referenced by 9 importer scripts (currently graceful-degrading to legacy schema; the import scripts work but log warnings every run). 00053's `permit_source_zips` table provides ZIP × source linkage rows for the dashboard map's coverage layer; the table exists but isn't being populated.
**Recommended fix**: Run `pnpm migrate` (which calls `scripts/apply-pending-migrations.ts`) once and confirm via `mcp__supabase__list_migrations`. ~2 min.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — All new tables follow the CLAUDE.md schema rule
**Files**: `supabase/migrations/00045–00047`, `00050`, `00051`, `00054`
**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md mandates `contractor_id uuid REFERENCES profiles(id) + RLS self-policy + created_at/updated_at + moddatetime trigger` on every contractor-scoped table. Verified:
- `cross_trade_suggestions` (00045): JSONB column on `leads`, feature-flagged via `WRITE_CROSS_TRADE_SUGGESTIONS` env var
- `referral_credits` (00046): `referrer_id` references `profiles(id)`, RLS `referrer_id = auth.uid()`, moddatetime trigger present
- `outreach_templates` (00047): system table seeded with 42 default templates (trade × stage × channel), partial unique index on `(trade, stage, channel)` for built-ins, RLS allows `SELECT TO authenticated`
- `storm_events` (00050): NOAA storm-events ingest table, RLS `SELECT TO authenticated`, no contractor scoping (reference data)
- `last_enriched_at` (00051): column added to `permits`, no RLS change (column-level), graceful-degrade pattern in code
- `webhook_idempotency` (00054): see F2

**Recommended fix**: None.
**Delta tag**: NEW (the migrations themselves) but UNCHANGED-pattern.

### F5. HEALTHY — RLS-self-policy invariant holds across the board
**Severity**: Low (positive finding)
**Why it matters**: `leads`, `estimates`, `territories`, `proposals`, `referral_credits`, `outreach_queue`, `outreach_templates` all have row-level-security enabled with the standard "owner sees only their rows" policy. Service-role bypass remains isolated to `src/lib/supabase/admin.ts` which is server-only. No new RLS holes introduced by the 9 new migrations.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

## Migration inventory

| File | Status (best-effort, verify via `mcp__supabase__list_migrations`) | Audit notes |
|---|---|---|
| 00001–00038 | Applied | Foundational schema |
| 00039_contact_provenance | Applied | Provenance tracking |
| 00040_voter_lookups | Applied | Voter-file enrichment |
| 00041_voter_files | Applied | Voter-file ingest |
| 00042_ppp_loans | Applied | PPP-loan ingest |
| 00043_enrich_indexes | Applied | Burst-enrich performance |
| 00044_leads_enrichment_columns | Applied | New jsonb columns |
| 00045_cross_trade_suggestions | Applied | Feature-flagged jsonb |
| 00046_referral_credits | Applied | Referral system |
| 00047_seed_outreach_templates | Applied | 42 default templates |
| **00048** | **MISSING** | Numbering gap — see F1 |
| **00049** | **MISSING** | Numbering gap — see F1 |
| 00050_storm_events | Applied | NOAA ingest |
| 00051_last_enriched_at | Applied | Re-enrich gating |
| 00052_permit_source_provenance | **PENDING** | See F3 |
| 00053_permit_source_zip_coverage | **PENDING** | See F3 |
| 00054_webhook_idempotency | Applied | NEW since 2026-04-28; wired |

## Verdict

Data layer is HEALTHY and trending up. Apply 00052/00053 + document the 00048/00049 gap and this becomes pristine.
