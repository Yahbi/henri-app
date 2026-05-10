/**
 * Apply migration 00094 — leads.source column + parcel_sidecar_uid +
 * partial unique index. Idempotent.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q, attempt = 0) => {
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
    if (attempt < 3) {
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML response, attempt ${attempt + 1}/3, waiting ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML response after 3 retries`);
  }
  return JSON.parse(text);
};

const f = "supabase/migrations/00094_leads_source_column.sql";
console.log(`=== applying ${f} ===`);
const body = readFileSync(f, "utf8");
const result = await sql(body);
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("ok");

console.log("\n=== verify columns + index ===");
const cols = await sql(`
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
    AND column_name IN ('source', 'parcel_sidecar_uid')
`);
console.log("columns:", JSON.stringify(cols, null, 2));

const idx = await sql(`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')
`);
console.log("indexes:", JSON.stringify(idx, null, 2));
