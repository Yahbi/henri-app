/**
 * Diagnostic v2: check overlap WHERE clause and confirm update path works.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  return r.json();
};

// 1) How many rows already marked production_grade?
console.log("Already marked:", await sql(`
  SELECT COUNT(*)::int AS n FROM permit_sources WHERE field_mapping_status = 'verified-by-hermes';
`));

// 2) Run a tiny UPDATE on ONE known-good token and see what comes back.
console.log("\nTest UPDATE on tdg3-whvc:");
const u = await sql(`
  UPDATE permit_sources
  SET discovered_via = 'production_grade_2026-04-29',
      priority = 0,
      field_mapping_status = 'verified-by-hermes',
      updated_at = NOW()
  WHERE endpoint ILIKE '%tdg3-whvc%'
  RETURNING id, source_key, endpoint, discovered_via, priority, field_mapping_status;
`);
console.log(JSON.stringify(u, null, 2).slice(0, 1500));

console.log("\nNow marked:", await sql(`
  SELECT COUNT(*)::int AS n FROM permit_sources WHERE field_mapping_status = 'verified-by-hermes';
`));
