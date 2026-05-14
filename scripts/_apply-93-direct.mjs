/**
 * Apply migration 00093 statement-by-statement (no BEGIN/COMMIT) to
 * surface the actual error from the Management API. The wrapped
 * transaction was silently rolling back on first statement failure.
 */
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
  if (text.startsWith("<")) return { __html: true };
  return JSON.parse(text);
};

const statements = [
  {
    name: "drop matview if exists",
    q: `DROP MATERIALIZED VIEW IF EXISTS public.zip_pre_intent_aggregates;`,
  },
  {
    name: "create matview WITH NO DATA",
    q: `
CREATE MATERIALIZED VIEW public.zip_pre_intent_aggregates AS
WITH base AS (
  SELECT
    zip,
    description,
    COALESCE(issued_date, applied_date, created_at::date) AS effective_date
  FROM public.permits
  WHERE zip IS NOT NULL
    AND zip <> ''
    AND COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '730 days'
)
SELECT
  zip,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '90 days'
      AND description ILIKE ANY (ARRAY['%adu%','%accessory dwelling%','%mother-in-law%','%granny flat%','%secondary unit%'])
  ) AS adu_90d,
  COUNT(*) FILTER (
    WHERE effective_date >= NOW() - INTERVAL '180 days'
      AND description ILIKE ANY (ARRAY['%remodel%','%renovation%','%addition%','%kitchen%','%bath%','%basement%'])
      AND description NOT ILIKE '%new construction%'
  ) AS remodel_180d,
  CASE
    WHEN COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days') = 0
      THEN NULL
    ELSE (
      COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days')::numeric
      - COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric
    ) / NULLIF(COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '730 days' AND effective_date < NOW() - INTERVAL '365 days')::numeric, 0)
  END AS yoy_growth,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '90 days')  AS permits_90d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '180 days') AS permits_180d,
  COUNT(*) FILTER (WHERE effective_date >= NOW() - INTERVAL '365 days') AS permits_365d,
  NOW() AS computed_at
FROM base
GROUP BY zip
WITH NO DATA;`,
  },
  {
    name: "unique index for CONCURRENTLY refresh",
    q: `CREATE UNIQUE INDEX IF NOT EXISTS zip_pre_intent_aggregates_zip_idx ON public.zip_pre_intent_aggregates (zip);`,
  },
  {
    name: "RLS grants",
    q: `
REVOKE ALL ON public.zip_pre_intent_aggregates FROM PUBLIC;
GRANT SELECT ON public.zip_pre_intent_aggregates TO authenticated;
GRANT SELECT ON public.zip_pre_intent_aggregates TO service_role;`,
  },
  {
    name: "refresh function",
    q: `
CREATE OR REPLACE FUNCTION public.refresh_zip_pre_intent_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zip_pre_intent_aggregates;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_zip_pre_intent_aggregates() TO service_role;`,
  },
];

for (const s of statements) {
  console.log(`\n=== ${s.name} ===`);
  const result = await sql(s.q);
  if (result?.__html) {
    console.error("HTML response — Management API timeout/overload");
    process.exit(1);
  }
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log("ok", result === null ? "" : Array.isArray(result) ? `(${result.length} rows)` : "");
}

console.log("\n=== check matview exists ===");
const mv = await sql(`SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = 'zip_pre_intent_aggregates'`);
console.log(JSON.stringify(mv, null, 2));
