/**
 * Apply migration 00139. Idempotent.
 *
 * Schema DDL plus a 10-row backfill, so this is a legitimate Management API
 * use. Bulk row DML must NOT go through this path — it took the database down
 * on 2026-08-04. See scripts/run-objobj-repair.mjs for the correct shape.
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
      console.log(`[retry] HTML response, attempt ${attempt + 1}/3, waiting ${Math.round(wait)}ms...`);
      await new Promise((res) => setTimeout(res, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML response after 3 retries`);
  }
  return JSON.parse(text);
};

const f = "supabase/migrations/00139_leads_enrich_attempted_at.sql";
console.log(`=== applying ${f} ===`);
const result = await sql(readFileSync(f, "utf8"));
if (result?.message && /ERROR/.test(result.message)) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log("applied.");

const checks = await sql(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name='territories' AND column_name='trade') AS trade_col,
    (SELECT count(*) FROM pg_indexes
      WHERE indexname='idx_territories_one_per_trade') AS uniq_idx,
    (SELECT count(*) FROM public.territories WHERE status='active' AND trade IS NULL) AS null_trade,
    (SELECT count(*) FROM public.territories WHERE status='active') AS active_total;
`);
console.log("verify:", JSON.stringify(checks));
