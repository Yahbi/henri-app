/**
 * Apply migration 00091 (stage-specific outreach templates) via
 * Supabase Management API. Idempotent — uses WHERE NOT EXISTS guard.
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

const f = "supabase/migrations/00091_stage_outreach_templates.sql";
console.log(`=== applying ${f} ===`);
const body = readFileSync(f, "utf8");
const result = await sql(body);
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("ok");

const verify = await sql(`
  SELECT name, stage FROM public.outreach_templates
  WHERE is_library = true
    AND contractor_id IS NULL
    AND stage IN (
      'permit_filed_no_contractor',
      'permit_filed_with_contractor',
      'stalled',
      'maintenance_upsell',
      'pre_intent'
    )
  ORDER BY stage;
`);
console.log("\n=== verification ===");
console.log(JSON.stringify(verify, null, 2));
