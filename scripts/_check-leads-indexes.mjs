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

console.log("=== leads indexes (looking for opportunity_stage + reason_codes) ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename = 'leads' AND indexname LIKE '%opportunity%' OR indexname LIKE '%reason%' OR indexname LIKE '%trade_tags%'`);
console.log(JSON.stringify(idx, null, 2));

console.log("\n=== all leads indexes (~5) ===");
const all = await sql(`SELECT indexname FROM pg_indexes WHERE tablename = 'leads' ORDER BY indexname LIMIT 20`);
console.log(JSON.stringify(all, null, 2));
