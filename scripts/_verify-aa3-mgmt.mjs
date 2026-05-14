/**
 * Verify AA-3 schema state directly via Management API (bypasses
 * PostgREST schema cache, which has been PGRST002-stuck after the
 * stacked DDL changes).
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const PROJECT_REF = "ivfxylgoxgrxttknewsf";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function sql(query, attempt = 0) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (text.startsWith("<")) {
    if (attempt < 3) {
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(query, attempt + 1);
    }
    return { __html_error: true };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { __parse_error: text.slice(0, 200) };
  }
}

console.log("=== matview state ===");
const mv = await sql(`SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = 'zip_pre_intent_aggregates'`);
console.log(JSON.stringify(mv, null, 2));

console.log("\n=== matview row count ===");
const cnt = await sql(`SELECT COUNT(*)::int AS n FROM public.zip_pre_intent_aggregates`);
console.log(JSON.stringify(cnt, null, 2));

console.log("\n=== top 10 ZIPs by 365d permit volume ===");
const sample = await sql(`
  SELECT zip, adu_90d, remodel_180d,
         ROUND(yoy_growth::numeric, 2) AS yoy,
         permits_365d
  FROM public.zip_pre_intent_aggregates
  WHERE permits_365d > 0
  ORDER BY permits_365d DESC
  LIMIT 10
`);
console.log(JSON.stringify(sample, null, 2));

console.log("\n=== ZIPs with ADU activity (≥3) ===");
const adu = await sql(`SELECT zip, adu_90d, permits_365d FROM public.zip_pre_intent_aggregates WHERE adu_90d >= 3 ORDER BY adu_90d DESC LIMIT 10`);
console.log(JSON.stringify(adu, null, 2));

console.log("\n=== ZIPs with remodel activity (≥5) ===");
const rem = await sql(`SELECT zip, remodel_180d, permits_365d FROM public.zip_pre_intent_aggregates WHERE remodel_180d >= 5 ORDER BY remodel_180d DESC LIMIT 10`);
console.log(JSON.stringify(rem, null, 2));

console.log("\n=== leads.source column existence ===");
const cols = await sql(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='leads'
    AND column_name IN ('source','parcel_sidecar_uid')
  ORDER BY column_name
`);
console.log(JSON.stringify(cols, null, 2));

console.log("\n=== leads.source distribution ===");
const dist = await sql(`SELECT source, COUNT(*)::int AS n FROM public.leads GROUP BY source`);
console.log(JSON.stringify(dist, null, 2));

console.log("\n=== indexes on leads ===");
const idx = await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')`);
console.log(JSON.stringify(idx, null, 2));
