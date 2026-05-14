/**
 * Apply migrations 00085 + 00086 via Supabase Management API.
 * Both are idempotent + additive (CREATE TABLE IF NOT EXISTS, ON CONFLICT
 * DO UPDATE), so re-running is safe.
 *
 *   00085 — parcels_sidecar + parcel_sources registry (7 substitute
 *           endpoints for the dead-permit states ME/MS/OK/UT/WV)
 *   00086 — lien_sources registry (UT SCR + 7 UCC portals + 4 new
 *           NH/RI/MS/WV contractor_license_sources rows)
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
  "supabase/migrations/00085_parcels_sidecar.sql",
  "supabase/migrations/00086_lien_sources_ut_scr.sql",
];

for (const f of files) {
  console.log(`\n=== applying ${f} ===`);
  const body = readFileSync(f, "utf8");
  const result = await sql(body);
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("ok");
}

console.log("\n=== post-apply sanity ===");
console.log("\nparcel_sources (00085):", await sql(`
  SELECT source_key, state_code, jurisdiction, source_kind, data_layer, enabled
  FROM parcel_sources ORDER BY state_code, source_key;
`));
console.log("\nparcels_sidecar columns:", await sql(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'parcels_sidecar'
  ORDER BY ordinal_position;
`));
console.log("\nlien_sources (00086):", await sql(`
  SELECT source_key, state_code, lien_kind, phase4_scrape, enabled
  FROM lien_sources ORDER BY state_code, source_key;
`));
console.log("\ncontractor_license_sources after 00086 net-new:", await sql(`
  SELECT state_code, source_kind, enabled
  FROM contractor_license_sources WHERE state_code IN ('NH','RI','MS','WV')
  ORDER BY state_code;
`));
