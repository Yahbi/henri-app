/**
 * Direct table probes (no pg_stat, no COUNT) to determine whether
 * the INSERT in commit d678b01 actually committed rows or whether
 * Postgres rolled back due to the lost response packet.
 *
 * Strategy: targeted SELECTs with the new partial index. Should be
 * sub-second even on a saturated DB.
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
        signal: AbortSignal.timeout(20000),
      },
    );
    const text = await r.text();
    if (text.startsWith("<")) return { html: r.status };
    return JSON.parse(text);
  } catch (e) {
    return { abort: e.message };
  }
};

console.log("=== probe 1: any lead with opportunity_stage (uses leads_opportunity_stage_idx) ===");
const stamped = await sql(`SELECT id, opportunity_stage FROM public.leads WHERE opportunity_stage IS NOT NULL LIMIT 3`);
console.log(JSON.stringify(stamped, null, 2));

console.log("\n=== probe 2: any row in stage_history (full-table-scan-on-empty) ===");
const any = await sql(`SELECT lead_id, to_stage, changed_by_kind FROM public.stage_history LIMIT 3`);
console.log(JSON.stringify(any, null, 2));

console.log("\n=== probe 3: stage_history total via fast EXISTS ===");
const exists = await sql(`SELECT EXISTS (SELECT 1 FROM public.stage_history) AS has_any`);
console.log(JSON.stringify(exists, null, 2));

console.log("\n=== probe 4: try stage_history backfill again (should be fast w/ index) ===");
const t0 = Date.now();
const insertResult = await sql(`
  WITH inserted AS (
    INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
    SELECT
      l.id, NULL, l.opportunity_stage,
      COALESCE(l.updated_at, l.created_at, NOW()),
      'backfill'
    FROM public.leads l
    WHERE l.opportunity_stage IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id)
    LIMIT 100
    RETURNING 1
  )
  SELECT COUNT(*)::int AS inserted FROM inserted
`);
console.log(`elapsed: ${Date.now() - t0}ms`);
console.log(JSON.stringify(insertResult, null, 2));
