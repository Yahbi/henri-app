/**
 * Insert 10 rows to test whether the path is functional at all.
 * If 10 succeeds, scale up. If 10 times out, the DB is fully wedged
 * and we'll need to defer to an operational restart.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q) => {
  try {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: q }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const text = await r.text();
    if (text.startsWith("<")) return { html: r.status };
    return JSON.parse(text);
  } catch (e) {
    return { abort: e.message };
  }
};

console.log("=== tiny INSERT (10 rows) ===");
const t0 = Date.now();
const r = await sql(`
  WITH src AS (
    SELECT id AS lead_id, opportunity_stage, COALESCE(updated_at, created_at, NOW()) AS changed_at
    FROM public.leads
    WHERE opportunity_stage IS NOT NULL
    LIMIT 10
  ), inserted AS (
    INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
    SELECT lead_id, NULL, opportunity_stage, changed_at, 'backfill'
    FROM src
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::int AS inserted FROM inserted
`);
console.log(`elapsed: ${Date.now() - t0}ms`);
console.log(JSON.stringify(r));

console.log("\n=== verify ===");
const v = await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history WHERE changed_by_kind = 'backfill'`);
console.log(JSON.stringify(v));
