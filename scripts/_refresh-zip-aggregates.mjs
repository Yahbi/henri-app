/**
 * Populate / refresh `zip_pre_intent_aggregates`.
 *
 * Strategy: send REFRESH directly via Management API (it returns
 * immediately on success even though the actual aggregate runs).
 * The 8s timeout applies to the API session, but REFRESH on a
 * matview WITH NO DATA actually runs FAST on a populated permits
 * table because the underlying aggregate is the same one we just
 * defined — Postgres has it ready.
 *
 * For the FIRST refresh we must use plain REFRESH (not CONCURRENTLY)
 * because CONCURRENTLY requires at least one prior successful refresh.
 *
 * Retries: up to 5 with backoff for transient HTML / 503 responses.
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
    if (attempt < 5) {
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML response, attempt ${attempt + 1}/5, waiting ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(query, attempt + 1);
    }
    throw new Error(`HTML response after 5 retries (status ${r.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 300)}`);
  }
}

console.log("=== check matview state ===");
const state = await sql(`SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = 'zip_pre_intent_aggregates'`);
console.log(JSON.stringify(state, null, 2));

const populated = state?.[0]?.ispopulated === true;

console.log(`\n=== ${populated ? "REFRESH CONCURRENTLY" : "REFRESH (first run)"} ===`);
const t0 = Date.now();
try {
  const result = await sql(
    populated
      ? "REFRESH MATERIALIZED VIEW CONCURRENTLY public.zip_pre_intent_aggregates"
      : "REFRESH MATERIALIZED VIEW public.zip_pre_intent_aggregates",
  );
  const elapsed = Date.now() - t0;
  console.log(`elapsed: ${elapsed}ms`);
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("ok");
} catch (e) {
  console.error("refresh failed:", e.message);
  process.exit(1);
}

console.log("\n=== verify row count ===");
const cnt = await sql(`SELECT COUNT(*)::int AS n FROM public.zip_pre_intent_aggregates`);
console.log("zip rows:", cnt?.[0]?.n);

console.log("\n=== top 10 ZIPs by 365d volume ===");
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

console.log("\n=== ZIPs with active ADU signal ===");
const adu = await sql(`
  SELECT zip, adu_90d, remodel_180d
  FROM public.zip_pre_intent_aggregates
  WHERE adu_90d >= 3
  ORDER BY adu_90d DESC
  LIMIT 10
`);
console.log(JSON.stringify(adu, null, 2));
