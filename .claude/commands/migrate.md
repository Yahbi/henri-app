---
description: Apply all pending Supabase migrations. Tries CLI / RPC / bundle paste, in that order.
---

You are about to apply any pending migrations in `supabase/migrations/` to the Henri Supabase project (`ivfxylgoxgrxttknewsf`).

## Preferred path: `pnpm migrate`

```
pnpm migrate
```

This runs `scripts/apply-pending-migrations.ts`, which:
1. Probes each migration's expected columns/tables via PostgREST.
2. Lists which are applied vs pending.
3. Tries to apply pending migrations via the `exec_sql(text)` RPC if exposed.
4. Falls back to writing a single combined SQL file at `supabase/_pending-bundle.sql` for copy-paste into the Supabase SQL editor.

The script is idempotent. Re-running is safe. All migrations use `IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so partial state is recoverable.

## Fallback path 1: Supabase CLI + access token

Required if the RPC isn't available AND you want automation:

```
# One-time setup
npm install -g supabase
setx SUPABASE_ACCESS_TOKEN <your-personal-token-from-https://app.supabase.com/account/tokens>

# Apply
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

After apply, the script re-probes the schema. You should see all migrations marked "applied" — except `00043_enrich_indexes` which always reports "PENDING" (CREATE INDEX is not directly observable via PostgREST; trust the apply).

## When migrations fail

Do NOT retry blindly. The script will print which migration failed and why. Read the error, fix-forward the SQL, re-run. Common causes:
- New migration references a column that doesn't exist yet (out-of-order)
- New migration's `CREATE TABLE` is missing `IF NOT EXISTS`
- An older migration's idempotency was broken by a manual edit in the web editor

Show the error to the user and ask whether to fix-forward or roll back the file before re-running.
