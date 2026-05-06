/**
 * One-shot migration applier for `supabase/migrations/00039_contact_provenance.sql`.
 *
 * Why this script exists:
 *   The canonical path is `pnpm migrate` (wraps `supabase db push`) or
 *   pasting the SQL into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new.
 *   Neither works for us right now:
 *     - `pnpm migrate` needs SUPABASE_ACCESS_TOKEN, which isn't in .env.local
 *     - Opening the web SQL editor means a human mouse + keyboard
 *
 *   So this script lands the three additive ALTER TABLE statements via
 *   PostgREST's RPC shim with the service-role key, which the app
 *   already has in .env.local. It runs the raw SQL through a plpgsql
 *   helper function `exec_sql(text)` if present, OR prints the SQL
 *   the user can paste directly if no such helper exists.
 *
 *   Additive-only, idempotent (`ADD COLUMN IF NOT EXISTS`), zero data
 *   mutation. Safe to re-run.
 *
 * Run:
 *   npx tsx scripts/apply-migration-00039.ts
 *
 * Success criteria: the three columns exist on `permits` and `leads`.
 * Verify with:
 *   curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
 *        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
 *        "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/permits?select=contact_source&limit=1"
 *   Should return `[{"contact_source": null}]` not a "column doesn't exist" error.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function columnExists(table: string, column: string): Promise<boolean> {
  // Cheapest existence check: try to `select column limit 1` and see if
  // PostgREST errors. A valid column returns null; missing column returns
  // 'column "x" does not exist'.
  const { error } = await s.from(table).select(column).limit(1);
  if (!error) return true;
  return !/does not exist|Could not find the column/i.test(error.message);
}

async function main() {
  console.log("checking current schema state...");
  const [permitsHas, leadsHas] = await Promise.all([
    columnExists("permits", "contact_source"),
    columnExists("leads", "contact_source"),
  ]);

  if (permitsHas && leadsHas) {
    console.log("migration 00039 already applied — both tables have contact_source. done.");
    return;
  }

  console.log(`permits.contact_source: ${permitsHas ? "yes" : "MISSING"}`);
  console.log(`leads.contact_source:   ${leadsHas ? "yes" : "MISSING"}`);

  // Try the exec_sql RPC path. A previous migration or a Supabase extension
  // may expose `exec_sql(text)`; if not, we fall back to printing the SQL.
  const sqlPath = path.resolve(
    process.cwd(),
    "supabase",
    "migrations",
    "00039_contact_provenance.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf-8");

  console.log("\nattempting to apply via RPC exec_sql...");
  const { error: rpcErr } = await s.rpc("exec_sql", { sql });

  if (!rpcErr) {
    console.log("applied via RPC — re-checking...");
    const [p2, l2] = await Promise.all([
      columnExists("permits", "contact_source"),
      columnExists("leads", "contact_source"),
    ]);
    if (p2 && l2) {
      console.log("migration 00039 applied successfully.");
      return;
    }
    console.warn("RPC returned ok but columns still missing — check Supabase logs.");
  } else {
    console.log(`RPC exec_sql not available (${rpcErr.message}). Printing SQL for manual apply:\n`);
  }

  console.log("──────────────────── copy-paste into Supabase SQL editor ────────────────────");
  console.log(`  ${SUPABASE_URL.replace("https://", "https://app.supabase.com/project/").replace(".supabase.co", "/sql/new")}`);
  console.log("────────────────────────────────────────────────────────────────────────────");
  console.log(sql);
  console.log("────────────────────────────────────────────────────────────────────────────");
  console.log(
    "\nAfter applying in the web editor, re-run this script to verify:\n  npx tsx scripts/apply-migration-00039.ts",
  );
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
