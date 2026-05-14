/**
 * Lean post-backfill probe — exists() + a small targeted SELECT to
 * confirm rows landed without triggering a full COUNT(*).
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
        signal: AbortSignal.timeout(15000),
      },
    );
    const text = await r.text();
    if (text.startsWith("<")) return { html: r.status };
    return JSON.parse(text);
  } catch (e) {
    return { abort: e.message };
  }
};

console.log("=== exists check (cheap) ===");
const exists = await sql(`SELECT EXISTS (SELECT 1 FROM public.stage_history LIMIT 1) AS has_rows`);
console.log(JSON.stringify(exists));

console.log("\n=== distinct changed_by_kind values ===");
const kinds = await sql(`SELECT DISTINCT changed_by_kind FROM public.stage_history`);
console.log(JSON.stringify(kinds, null, 2));

console.log("\n=== sample 3 backfill rows ===");
const sample = await sql(
  `SELECT lead_id, to_stage, changed_at::text AS changed_at, changed_by_kind FROM public.stage_history WHERE changed_by_kind = 'backfill' LIMIT 3`,
);
console.log(JSON.stringify(sample, null, 2));

// Skip full COUNT(*) — the connection-pool times it out. Instead use
// pg_stat_user_tables to get the planner's estimated row count.
console.log("\n=== estimated row count (pg_stat) ===");
const stat = await sql(
  `SELECT schemaname, relname, n_live_tup::int AS estimated_rows FROM pg_stat_user_tables WHERE relname = 'stage_history'`,
);
console.log(JSON.stringify(stat, null, 2));
