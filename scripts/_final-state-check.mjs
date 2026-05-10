/**
 * Final state probe after Micro upgrade. Should confirm:
 * - leads.opportunity_stage stamped count vs total
 * - stage_history rows populated
 * - zip_pre_intent_aggregates rows populated
 * - sample populated rows from each
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

console.log("=== leads stamping ===");
const leads = await sql(`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE opportunity_stage IS NOT NULL)::int AS stamped,
    ROUND(100.0 * COUNT(*) FILTER (WHERE opportunity_stage IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct
  FROM public.leads
`);
console.log(JSON.stringify(leads, null, 2));

console.log("\n=== stage_history ===");
const sh = await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history`);
console.log(JSON.stringify(sh, null, 2));

console.log("\n=== zip_pre_intent_aggregates ===");
const zip = await sql(`SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE adu_90d > 0)::int AS adu_active, COUNT(*) FILTER (WHERE remodel_180d >= 5)::int AS remodel_active FROM public.zip_pre_intent_aggregates`);
console.log(JSON.stringify(zip, null, 2));

console.log("\n=== top 5 ZIPs by 365d permit volume ===");
const top = await sql(`
  SELECT zip, adu_90d, remodel_180d, ROUND(yoy_growth::numeric, 2) AS yoy, permits_365d
  FROM public.zip_pre_intent_aggregates
  ORDER BY permits_365d DESC NULLS LAST
  LIMIT 5
`);
console.log(JSON.stringify(top, null, 2));

console.log("\n=== sample 3 stage_history rows (backfill) ===");
const ss = await sql(`SELECT lead_id, to_stage, changed_by_kind, changed_at::text FROM public.stage_history WHERE changed_by_kind = 'backfill' LIMIT 3`);
console.log(JSON.stringify(ss, null, 2));
