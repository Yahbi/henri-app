/**
 * Apply migration 00110 — contact_views analytics table (WS7). Idempotent.
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

const f = "supabase/migrations/00110_contact_views.sql";
console.log(`=== applying ${f} ===`);
const body = readFileSync(f, "utf8");
const result = await sql(body);
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("ok");

console.log("\n=== verify table + indexes + policies ===");
const tbl = await sql(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'contact_views'
`);
console.log("table:", JSON.stringify(tbl, null, 2));

const idx = await sql(`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'contact_views'
`);
console.log("indexes:", JSON.stringify(idx, null, 2));

const pol = await sql(`
  SELECT policyname, cmd FROM pg_policies
  WHERE tablename = 'contact_views'
`);
console.log("policies:", JSON.stringify(pol, null, 2));
