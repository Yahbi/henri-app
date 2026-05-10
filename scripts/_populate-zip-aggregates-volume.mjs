/**
 * Pragmatic populate of zip_pre_intent_aggregates: volume-only fields
 * (no FILTER + ILIKE which times out at 120s even on a single ZIP-prefix
 * chunk over the 1.4M permits table).
 *
 * Trade-off: lights up 1 of 3 starved reason codes (`neighborhood_upgrade_trend`
 * via `yoy_growth`). The ADU + remodel ILIKE-specific codes stay null
 * until a follow-on populator runs the heavier query against an indexed
 * description column or a smaller permit window.
 *
 * Strategy: 100 chunks by 2-char ZIP prefix (00-99). Each chunk
 * touches ~14k permits and finishes in 1-3s — comfortably under the
 * Cloudflare 524 ceiling.
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
    if (attempt < 3) {
      const wait = 2000 * Math.pow(1.5, attempt);
      console.log(`  [retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    return { __html_error: true };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { __parse_error: text.slice(0, 200) };
  }
};

console.log("=== preflight: confirm table exists ===");
const tbl = await sql(`SELECT to_regclass('public.zip_pre_intent_aggregates')::text AS t`);
console.log(JSON.stringify(tbl));
if (!tbl?.[0]?.t) {
  console.error("table does not exist — run create-table step first");
  process.exit(1);
}

console.log("\n=== truncate (idempotent re-population) ===");
await sql(`TRUNCATE public.zip_pre_intent_aggregates`);

console.log("\n=== populate per 2-char ZIP-prefix (100 chunks) ===");
let chunksOk = 0;
let chunksSkipped = 0;
let chunksFailed = 0;

for (let i = 0; i < 100; i++) {
  const prefix = i.toString().padStart(2, "0");
  const t0 = Date.now();
  const insertSql = `
INSERT INTO public.zip_pre_intent_aggregates
  (zip, adu_90d, remodel_180d, yoy_growth, permits_90d, permits_180d, permits_365d)
WITH base AS (
  SELECT
    zip,
    COALESCE(issued_date, applied_date, created_at::date) AS effective_date
  FROM public.permits
  WHERE zip IS NOT NULL
    AND zip <> ''
    AND zip LIKE '${prefix}%'
    AND COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '730 days'
)
SELECT
  zip,
  0::int AS adu_90d,
  0::int AS remodel_180d,
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
  yoy_growth = EXCLUDED.yoy_growth,
  permits_90d = EXCLUDED.permits_90d,
  permits_180d = EXCLUDED.permits_180d,
  permits_365d = EXCLUDED.permits_365d,
  computed_at = NOW()
`;
  const result = await sql(insertSql);
  const elapsed = Date.now() - t0;
  if (result?.__html_error) {
    chunksFailed++;
    console.log(`prefix ${prefix}: HTML retry exhausted in ${elapsed}ms`);
    continue;
  }
  if (result?.message && /ERROR/.test(result.message)) {
    chunksFailed++;
    if (/timeout/.test(result.message)) {
      console.log(`prefix ${prefix}: TIMEOUT in ${elapsed}ms`);
    } else {
      console.error(`prefix ${prefix}: ERROR — ${result.message.slice(0, 100)}`);
    }
    continue;
  }
  chunksOk++;
  if (i % 10 === 0 || elapsed > 3000) {
    console.log(`prefix ${prefix}: ok in ${elapsed}ms (${chunksOk} ok / ${chunksFailed} failed so far)`);
  }
}

console.log(`\n=== done: ${chunksOk} ok / ${chunksFailed} failed / ${chunksSkipped} skipped ===`);

console.log("\n=== verify final state ===");
const cnt = await sql(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE permits_365d > 0)::int AS active FROM public.zip_pre_intent_aggregates`);
console.log("zip rows:", JSON.stringify(cnt, null, 2));

const top = await sql(`SELECT zip, ROUND(yoy_growth::numeric, 2) AS yoy, permits_90d, permits_180d, permits_365d FROM public.zip_pre_intent_aggregates WHERE permits_365d > 0 ORDER BY permits_365d DESC LIMIT 10`);
console.log("\ntop 10 ZIPs by 365d volume:", JSON.stringify(top, null, 2));
