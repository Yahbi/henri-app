/**
 * Apply migration 00092 (stage_history table + trigger) via Supabase
 * Management API. Idempotent.
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
  return r.json();
};

const f = "supabase/migrations/00092_stage_history.sql";
console.log(`=== applying ${f} ===`);
const body = readFileSync(f, "utf8");
const result = await sql(body);
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("ok");

// Quick verify the table + triggers exist.
const verify = await sql(`
  SELECT
    EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='stage_history') AS table_exists,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='leads_stage_history_insert') AS insert_trigger_exists,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='leads_stage_history_update') AS update_trigger_exists;
`);
console.log("\n=== verification ===");
console.log(JSON.stringify(verify, null, 2));
