---
name: apply-migrations
description: Apply all pending Supabase migrations. Tries CLI / RPC / bundle paste, in that order.
---

# Apply pending Supabase migrations

You're about to apply migrations in `supabase/migrations/` to the Henri Supabase project (`ivfxylgoxgrxttknewsf`).

## Preferred path: `pnpm migrate`

```bash
pnpm migrate
```

This runs `scripts/apply-pending-migrations.ts`, which:

1. Probes each migration's expected columns/tables via PostgREST
2. Lists which are applied vs pending
3. Tries to apply pending migrations via the `exec_sql(text)` RPC if exposed
4. Falls back to writing a single combined SQL file at `supabase/_pending-bundle.sql` for copy-paste into the Supabase SQL editor

The script is idempotent. All migrations use `IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.

## Fallback path 1: Supabase CLI + access token

```bash
npm install -g supabase
setx SUPABASE_ACCESS_TOKEN <your-personal-token-from-https://app.supabase.com/account/tokens>
npx --yes supabase@latest link --project-ref ivfxylgoxgrxttknewsf
npx --yes supabase@latest db push
```

## Fallback path 2: Web SQL editor (always works)

If `pnpm migrate` printed the bundle path:

1. Open <https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new>
2. Paste the contents of `supabase/_pending-bundle.sql`
3. Click **Run**
4. Re-run `pnpm migrate` to verify all green

## Verification

After apply, the script re-probes the schema. All migrations should report applied except `00043_enrich_indexes` (CREATE INDEX is not directly observable via PostgREST).

## When migrations fail

Do NOT retry blindly. Read the error, fix-forward the SQL, re-run. Common causes:

- New migration references a column that doesn't exist yet (out-of-order)
- New migration's `CREATE TABLE` is missing `IF NOT EXISTS`
- An older migration's idempotency was broken by a manual edit in the web editor

Show the error to the user and ask whether to fix-forward or roll back the file.

## Currently pending (as of 2026-04-26)

- `00039_contact_provenance` — contact_source / confidence / extracted_at on permits + leads
- `00040_voter_lookups`
- `00041_voter_files` — voter_fl, voter_nc, voter_oh
- `00042_ppp_loans`
- `00043_enrich_indexes` — partial indexes (blocking burst-enrich performance)
- `00044_leads_enrichment_columns` — 8 fields (employer, occupation, business_*, license_*, naics_code)
- `00045_cross_trade_suggestions` — predictive engine column
- `00046_referral_credits` — Stripe webhook idempotency log
- `00047_seed_outreach_templates` — 42 system templates (depends on 00032 applied)
- `00050_storm_events` — NOAA Storm Events ingest table

After applying, set env flags:

- `WRITE_PROVENANCE=1` — activates 00039 writes
- `WRITE_EXTENDED=1` — activates 00044 writes
- `WRITE_CROSS_TRADE_SUGGESTIONS=1` — activates predictive cron writer
