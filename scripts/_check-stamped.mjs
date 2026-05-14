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

console.log("=== stage_history total ===");
console.log(JSON.stringify(await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history`)));

console.log("\n=== leads with opportunity_stage (small probe) ===");
const probe = await sql(`SELECT id, opportunity_stage FROM public.leads WHERE opportunity_stage IS NOT NULL LIMIT 3`);
console.log(JSON.stringify(probe, null, 2));

console.log("\n=== count via sample (avoid full scan) ===");
const sample = await sql(`SELECT COUNT(*)::int AS n FROM public.leads WHERE opportunity_stage IS NOT NULL AND id < '01000000-0000-0000-0000-000000000000'::uuid`);
console.log(`small id-range count: ${JSON.stringify(sample)}`);
