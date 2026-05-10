/**
 * Apply migration 00094 statement-by-statement to bypass the
 * Management API's silent transaction rollback. Each ALTER TABLE
 * commits independently; CREATE INDEX outside a transaction is fast
 * because the leads table doesn't have a heavy index on source yet.
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
    name: "add leads.source column",
    q: `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'permit';`,
  },
  {
    name: "add leads.parcel_sidecar_uid column",
    q: `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS parcel_sidecar_uid UUID;`,
  },
  {
    name: "partial unique index on (contractor_id, parcel_sidecar_uid)",
    q: `CREATE UNIQUE INDEX IF NOT EXISTS leads_contractor_parcel_uq ON public.leads (contractor_id, parcel_sidecar_uid) WHERE parcel_sidecar_uid IS NOT NULL;`,
  },
  {
    name: "partial index on source",
    q: `CREATE INDEX IF NOT EXISTS leads_source_idx ON public.leads (source) WHERE source <> 'permit';`,
  },
];

for (const s of statements) {
  console.log(`\n=== ${s.name} ===`);
  const result = await sql(s.q);
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("ok", Array.isArray(result) ? `(${result.length} rows)` : "");
}

console.log("\n=== verify columns ===");
const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('source','parcel_sidecar_uid')`);
console.log(JSON.stringify(cols, null, 2));

console.log("\n=== verify indexes ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')`);
console.log(JSON.stringify(idx, null, 2));
