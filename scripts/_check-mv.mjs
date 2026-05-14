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
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) {
    return { __html_error: text.slice(0, 200) };
  }
  return JSON.parse(text);
};

console.log("=== check materialised view existence ===");
const matviews = await sql(`
  SELECT schemaname, matviewname, ispopulated, hasindexes
  FROM pg_matviews
  WHERE matviewname = 'zip_pre_intent_aggregates'
`);
console.log(JSON.stringify(matviews, null, 2));

console.log("\n=== check row count ===");
const cnt = await sql(`SELECT COUNT(*)::int AS n FROM public.zip_pre_intent_aggregates`);
console.log(JSON.stringify(cnt, null, 2));

console.log("\n=== sample 5 active ZIPs ===");
const sample = await sql(`
  SELECT zip, adu_90d, remodel_180d,
         ROUND(yoy_growth::numeric, 2) AS yoy,
         permits_365d
  FROM public.zip_pre_intent_aggregates
  WHERE permits_365d > 0
  ORDER BY permits_365d DESC
  LIMIT 5
`);
console.log(JSON.stringify(sample, null, 2));
