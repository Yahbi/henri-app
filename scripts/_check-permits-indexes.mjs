import path from "node:path";
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
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) return { __html: r.status };
  return JSON.parse(text);
};

console.log("=== indexes on permits ===");
const idx = await sql(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='permits' ORDER BY indexname`);
console.log(JSON.stringify(idx, null, 2));

console.log("\n=== sample query: count permits in ZIP '06106' (Hartford CT) ===");
const t0 = Date.now();
const r = await sql(`SELECT COUNT(*)::int AS n FROM permits WHERE zip = '06106'`);
console.log(`elapsed ${Date.now() - t0}ms:`, JSON.stringify(r));
