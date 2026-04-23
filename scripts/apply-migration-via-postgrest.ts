/**
 * Try every available mechanism to apply an arbitrary SQL migration
 * against the Supabase project. Exits 0 on first success, 1 if none
 * of the paths work (in which case the user needs to paste the
 * migration into the Supabase SQL editor).
 *
 * Paths attempted, in order:
 *   1. Known custom RPCs: exec / execute_sql / run_sql / sql
 *   2. pg-meta internal endpoint at /pg/meta/default/query
 *      (works if project has it enabled)
 *   3. Supabase Management API /v1/projects/.../database/query
 *      (requires SUPABASE_ACCESS_TOKEN — personal access token)
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: npx tsx apply-migration-via-postgrest.ts <migration-file>");
  process.exit(1);
}
const sql = fs.readFileSync(path.resolve(migrationFile), "utf-8");

async function tryRpc(name: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });
  if (res.ok) {
    console.log(`  ✓ Applied via rpc/${name}`);
    return true;
  }
  return false;
}

async function tryPgMeta(): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/pg/meta/default/query`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) {
    console.log("  ✓ Applied via /pg/meta/default/query");
    return true;
  }
  return false;
}

async function tryManagementApi(): Promise<boolean> {
  if (!ACCESS_TOKEN || !PROJECT_REF) return false;
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (res.ok) {
    console.log("  ✓ Applied via Supabase Management API");
    return true;
  }
  const msg = await res.text().catch(() => "");
  console.log(`  Management API ${res.status}: ${msg.slice(0, 200)}`);
  return false;
}

(async () => {
  for (const fn of ["exec", "execute_sql", "run_sql", "sql"]) {
    if (await tryRpc(fn)) process.exit(0);
  }
  if (await tryPgMeta()) process.exit(0);
  if (await tryManagementApi()) process.exit(0);
  console.error(
    "\n✗ No path available to apply migration programmatically.\n\n" +
      "Apply it manually via the Supabase SQL editor:\n" +
      `  1. Open https://app.supabase.com/project/${PROJECT_REF ?? "…"}/sql/new\n` +
      `  2. Paste the contents of ${migrationFile}\n` +
      `  3. Click Run\n`,
  );
  process.exit(1);
})();
