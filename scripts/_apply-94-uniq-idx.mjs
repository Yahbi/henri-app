/**
 * Build the partial unique index leads_contractor_parcel_uq.
 * It's WHERE parcel_sidecar_uid IS NOT NULL — and right now there are
 * ZERO rows with that column non-null (we haven't synthesised yet),
 * so the index build is essentially free.
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

console.log("=== build unique parcel index CONCURRENTLY ===");
const t0 = Date.now();
const r = await sql(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_contractor_parcel_uq ON public.leads (contractor_id, parcel_sidecar_uid) WHERE parcel_sidecar_uid IS NOT NULL`);
console.log(`elapsed: ${Date.now() - t0}ms`);
if (r?.message && /ERROR/.test(r.message)) {
  console.error(JSON.stringify(r, null, 2));
  process.exit(1);
}
console.log("ok");

console.log("\n=== verify both indexes ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx') ORDER BY indexname`);
console.log(JSON.stringify(idx, null, 2));

console.log("\n=== confirm columns + defaults ===");
const cols = await sql(`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('source','parcel_sidecar_uid') ORDER BY column_name`);
console.log(JSON.stringify(cols, null, 2));
