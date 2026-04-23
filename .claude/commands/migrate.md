---
description: Apply all pending Supabase migrations using the CLI, with a pasteable fallback.
---

You are about to apply any pending migrations in `supabase/migrations/` to the Henri Supabase project (`ivfxylgoxgrxttknewsf`).

## Preconditions
1. Supabase CLI must be installed (`supabase --version` should print a semver). If missing, run:
   - `npm install -g supabase` (preferred), or
   - `scoop install supabase` (Windows)
2. `SUPABASE_ACCESS_TOKEN` must exist in the environment (not in `.env.local` — that's a project secret, the CLI uses your personal token). If missing, print:
   ```
   Generate a personal token at https://app.supabase.com/account/tokens and run:
     setx SUPABASE_ACCESS_TOKEN <token>
   Then re-run `/migrate`.
   ```
3. `DATABASE_URL` from the Supabase dashboard → Project Settings → Database → URI (direct, not pooler) should be available; otherwise fall back to the CLI's `--linked` mode.

## Steps
1. Run `npx --yes supabase@latest link --project-ref ivfxylgoxgrxttknewsf` if the project isn't already linked.
2. Run `npx --yes supabase@latest db push` to apply every migration in `supabase/migrations/` that hasn't been applied yet.
3. Run `npx tsx scripts/audit-desktop-sync.ts` to confirm row counts are intact and RLS hasn't broken anything.
4. If any migration fails, DO NOT retry blindly. Show the error, diagnose, and ask the user whether to fix-forward or roll back the broken file.

## Fallback (no CLI / no token)
Print the clickable link https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new and the full contents of every `.sql` file in `supabase/migrations/` that isn't already in the schema (cross-reference by filename against `supabase_migrations.schema_migrations` if queryable).

## Verification
After a successful apply, confirm each new table exists:
```
npx tsx -e "import {createClient} from '@supabase/supabase-js'; import * as dotenv from 'dotenv'; dotenv.config({path:'.env.local'}); const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!); for (const t of ['lead_exclusivity_locks','permit_events','missed_call_events','feedback']) { const {error}=await s.from(t).select('id',{head:true,count:'estimated'}); console.log(t, error?.message ?? 'ok'); }"
```

Report which tables landed and which the fallback path still needs pasted manually.
