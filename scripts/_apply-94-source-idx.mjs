/**
 * Build only the partial source index (leads_source_idx) — the
 * unique parcel index already finished in 15s. CONCURRENTLY so
 * it doesn't lock the leads table.
 */
import path from "node:path";
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
      const wait = 4000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 3 retries`);
  }
  return JSON.parse(text);
};

console.log("=== check first index already exists ===");
const idx1 = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname='leads_contractor_parcel_uq'`);
console.log(JSON.stringify(idx1));

console.log("\n=== build source index CONCURRENTLY ===");
const t0 = Date.now();
const r = await sql(`CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_source_idx ON public.leads (source) WHERE source <> 'permit'`);
console.log(`elapsed: ${Date.now() - t0}ms`);
if (r?.message && /ERROR/.test(r.message)) {
  console.error(JSON.stringify(r, null, 2));
  process.exit(1);
}
console.log("ok");

console.log("\n=== verify both indexes ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')`);
console.log(JSON.stringify(idx, null, 2));

console.log("\n=== leads.source distribution ===");
const dist = await sql(`SELECT source, COUNT(*)::int AS n FROM public.leads GROUP BY source`);
console.log(JSON.stringify(dist, null, 2));
