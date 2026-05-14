/**
 * Apply migration 00093 — zip_pre_intent_aggregates materialised view +
 * refresh function. Idempotent (DROP+CREATE pattern).
 *
 * Initial materialisation runs as part of the CREATE MATERIALIZED VIEW
 * statement, so by the time the migration commits the view is populated
 * and queryable. Subsequent updates run via `refresh_zip_pre_intent_aggregates()`.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) {
    throw new Error(`Management API returned HTML (status ${r.status})`);
  }
  return JSON.parse(text);
};

const f = "supabase/migrations/00093_zip_pre_intent_aggregates.sql";
console.log(`=== applying ${f} ===`);
const body = readFileSync(f, "utf8");
const result = await sql(body);
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("ok");

console.log("\n=== verification: row count + sample ===");
try {
  const count = await sql(`SELECT COUNT(*)::int AS n FROM zip_pre_intent_aggregates`);
  console.log("total ZIP rows:", count?.[0]?.n ?? "?");

  const sample = await sql(`
    SELECT zip, adu_90d, remodel_180d, yoy_growth, permits_365d
    FROM zip_pre_intent_aggregates
    WHERE adu_90d > 0 OR remodel_180d >= 5
    ORDER BY permits_365d DESC
    LIMIT 10
  `);
  console.log("\nactive ZIPs (top 10 by 365d volume):");
  console.log(JSON.stringify(sample, null, 2));
} catch (e) {
  console.error("verification failed:", e.message);
}
