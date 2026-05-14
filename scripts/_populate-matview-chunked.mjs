/**
 * Populate `zip_pre_intent_aggregates` by computing per-ZIP rows
 * directly via Management API queries chunked by ZIP-prefix, then
 * INSERTing into a "shadow" table that we then atomically swap into
 * the matview's underlying storage.
 *
 * Why this strategy: REFRESH MATERIALIZED VIEW does the same aggregate
 * the matview body defines, in a single statement. That single
 * statement times out at 8s on the Management API even though the
 * aggregate itself is doable in ~10-15s on Postgres. Splitting the
 * work into ZIP-prefix chunks (e.g. ZIPs starting with '0', '1', '2',
 * …, '9') gives 10 separate queries, each well under 8s.
 *
 * Approach:
 *   1. CREATE TABLE zip_pre_intent_staging (same shape as matview)
 *   2. INSERT … per ZIP prefix (10 chunks)
 *   3. ALTER MATERIALIZED VIEW … RENAME (swap storage) — actually a
 *      cleaner path is to drop the matview and recreate as a regular
 *      VIEW over the staging table, OR keep the matview definition but
 *      pg_dump-restore semantics. Simpler: we just keep the staging
 *      table and rewrite the score cron to read from staging instead.
 *
 *   4. Actually simplest: skip the matview entirely. Use the staging
 *      TABLE as the source of truth + a pg_cron / app-cron that
 *      truncates + re-INSERTs weekly. The score cron query stays
 *      identical because we'll name the table the same.
 *
 * Final shape (decided after first round): drop the matview, create
 * a regular table `public.zip_pre_intent_aggregates` with the same
 * schema, and populate it via 10 chunked INSERTs. Subsequent refreshes
 * are TRUNCATE + 10 INSERTs.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const PROJECT_REF = "ivfxylgoxgrxttknewsf";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const sql = async (q, attempt = 0) => {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: q }),
  });
  const text = await r.text();
  if (text.startsWith("<")) {
    if (attempt < 5) {
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/5, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 5 retries`);
  }
  return JSON.parse(text);
};

console.log("=== STEP 1: drop matview, create regular table ===");
await sql(`DROP MATERIALIZED VIEW IF EXISTS public.zip_pre_intent_aggregates CASCADE`);
console.log("dropped matview");

await sql(`
CREATE TABLE IF NOT EXISTS public.zip_pre_intent_aggregates (
  zip TEXT PRIMARY KEY,
  adu_90d INTEGER NOT NULL DEFAULT 0,
  remodel_180d INTEGER NOT NULL DEFAULT 0,
  yoy_growth NUMERIC,
  permits_90d INTEGER NOT NULL DEFAULT 0,
  permits_180d INTEGER NOT NULL DEFAULT 0,
  permits_365d INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
console.log("created table");

await sql(`REVOKE ALL ON public.zip_pre_intent_aggregates FROM PUBLIC`);
await sql(`GRANT SELECT ON public.zip_pre_intent_aggregates TO authenticated`);
await sql(`GRANT SELECT ON public.zip_pre_intent_aggregates TO service_role`);
console.log("grants set");

console.log("\n=== STEP 2: truncate + populate per ZIP-prefix (10 chunks) ===");
await sql(`TRUNCATE public.zip_pre_intent_aggregates`);

const PREFIXES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
let totalInserted = 0;

for (const prefix of PREFIXES) {
  const t0 = Date.now();
  const insertSql = `
INSERT INTO public.zip_pre_intent_aggregates
  (zip, adu_90d, remodel_180d, yoy_growth, permits_90d, permits_180d, permits_365d)
WITH base AS (
  SELECT
    zip,
    description,
    COALESCE(issued_date, applied_date, created_at::date) AS effective_date
  FROM public.permits
  WHERE zip IS NOT NULL
    AND zip <> ''
    AND zip LIKE '${prefix}%'
    AND COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '730 days'
)
SELECT
  zip,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '90 days'
      AND description ILIKE ANY (ARRAY['%adu%','%accessory dwelling%','%mother-in-law%','%granny flat%','%secondary unit%'])
  )::int AS adu_90d,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '180 days'
      AND description ILIKE ANY (ARRAY['%remodel%','%renovation%','%addition%','%kitchen%','%bath%','%basement%'])
      AND description NOT ILIKE '%new construction%'
  )::int AS remodel_180d,
  CASE
    WHEN COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days') = 0
      THEN NULL
    ELSE (
      COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days')::numeric
      - COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric
    ) / NULLIF(COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric, 0)
  END AS yoy_growth,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '90 days')::int AS permits_90d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '180 days')::int AS permits_180d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days')::int AS permits_365d
FROM base
GROUP BY zip
ON CONFLICT (zip) DO UPDATE SET
  adu_90d = EXCLUDED.adu_90d,
  remodel_180d = EXCLUDED.remodel_180d,
  yoy_growth = EXCLUDED.yoy_growth,
  permits_90d = EXCLUDED.permits_90d,
  permits_180d = EXCLUDED.permits_180d,
  permits_365d = EXCLUDED.permits_365d,
  computed_at = NOW()
`;
  const result = await sql(insertSql);
  const elapsed = Date.now() - t0;
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(`prefix ${prefix} FAILED in ${elapsed}ms:`, result.message);
    continue;
  }
  console.log(`prefix ${prefix}: ok in ${elapsed}ms`);
}

console.log("\n=== STEP 3: verify ===");
const cnt = await sql(`SELECT COUNT(*)::int AS n FROM public.zip_pre_intent_aggregates`);
console.log("total ZIP rows:", cnt?.[0]?.n);

const sample = await sql(`SELECT zip, adu_90d, remodel_180d, ROUND(yoy_growth::numeric, 2) AS yoy, permits_365d FROM public.zip_pre_intent_aggregates WHERE permits_365d > 0 ORDER BY permits_365d DESC LIMIT 10`);
console.log("\ntop 10:", JSON.stringify(sample, null, 2));

const adu = await sql(`SELECT zip, adu_90d FROM public.zip_pre_intent_aggregates WHERE adu_90d >= 3 ORDER BY adu_90d DESC LIMIT 10`);
console.log("\nADU-active (≥3):", JSON.stringify(adu, null, 2));
