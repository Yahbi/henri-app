/**
 * Apply migrations 00082, 00083, 00084 via Supabase Management API.
 *
 * All three are idempotent + additive (CREATE OR REPLACE / IF NOT EXISTS /
 * ON CONFLICT DO UPDATE), so re-running this script is safe.
 *
 *   00082 — owner_occupied_mailing_situs (helper functions + view)
 *   00083 — license_rosters_10_states (10 new contractor_license_sources rows)
 *   00084 — liens_county_recorder (new sidecar table + indexes + RLS)
 */
import path from "node:path";
import { readFileSync } from "node:fs";
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

const files = [
  "supabase/migrations/00082_owner_occupied_mailing_situs.sql",
  "supabase/migrations/00083_license_rosters_10_states.sql",
  "supabase/migrations/00084_liens_county_recorder.sql",
];

for (const f of files) {
  console.log(`\n=== applying ${f} ===`);
  const body = readFileSync(f, "utf8");
  const result = await sql(body);
  console.log(JSON.stringify(result, null, 2).slice(0, 800));
}

// Post-apply sanity:
console.log("\n=== post-apply sanity ===");
console.log("compute_owner_occupied():", await sql(`
  SELECT public.compute_owner_occupied('123 Main St, Miami', '123 Main St') AS owner_occupied,
         public.compute_owner_occupied('123 Main St', '999 Investor Way') AS investor_owned,
         public.compute_owner_occupied('123 Main St', NULL) AS unknown;
`));
console.log("\ncontractor_license_sources after 00083:", await sql(`
  SELECT state_code, source_kind, enabled
  FROM contractor_license_sources
  ORDER BY state_code;
`));
console.log("\nliens_county_recorder structure:", await sql(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'liens_county_recorder'
  ORDER BY ordinal_position;
`));
