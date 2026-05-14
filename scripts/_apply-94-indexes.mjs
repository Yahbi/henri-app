/**
 * Build the two leads indexes from migration 00094 using CONCURRENTLY.
 * Plain CREATE INDEX on a 270k-row table tripped the 8s statement
 * timeout; CONCURRENTLY isn't subject to the same ceiling because it
 * builds incrementally without an exclusive lock.
 *
 * CONCURRENTLY cannot run inside an explicit transaction — sending
 * each as its own statement is the right shape.
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
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 3 retries (status ${r.status})`);
  }
  return JSON.parse(text);
};

const statements = [
  {
    name: "partial unique index on (contractor_id, parcel_sidecar_uid) CONCURRENTLY",
    q: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_contractor_parcel_uq ON public.leads (contractor_id, parcel_sidecar_uid) WHERE parcel_sidecar_uid IS NOT NULL;`,
  },
  {
    name: "partial source index CONCURRENTLY",
    q: `CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_source_idx ON public.leads (source) WHERE source <> 'permit';`,
  },
];

for (const s of statements) {
  console.log(`\n=== ${s.name} ===`);
  const t0 = Date.now();
  const result = await sql(s.q);
  console.log(`elapsed: ${Date.now() - t0}ms`);
  if (result?.message && /ERROR/.test(result.message)) {
    // INVALID-STATE 25001: "CREATE INDEX CONCURRENTLY cannot run inside a transaction"
    // is fine — Management API may wrap; ignore + retry without via /database/query.
    // Otherwise, fail loud.
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("ok", Array.isArray(result) ? `(${result.length} rows)` : "");
}

console.log("\n=== verify indexes ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')`);
console.log(JSON.stringify(idx, null, 2));

console.log("\n=== verify columns ===");
const cols = await sql(`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('source','parcel_sidecar_uid') ORDER BY column_name`);
console.log(JSON.stringify(cols, null, 2));

console.log("\n=== leads.source distribution ===");
const dist = await sql(`SELECT source, COUNT(*)::int AS n FROM public.leads GROUP BY source`);
console.log(JSON.stringify(dist, null, 2));
