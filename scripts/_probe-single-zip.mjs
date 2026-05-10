/**
 * Single-ZIP probe — see if any aggregate works at all.
 * If even one ZIP returns rows in <8s we can populate the table
 * iteratively (one ZIP at a time).
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
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) return { __html: r.status };
  try { return JSON.parse(text); } catch { return { __raw: text.slice(0, 200) }; }
};

// Try a known-active ZIP first.
async function probe(label, q) {
  const t0 = Date.now();
  try {
    const r = await sql(q);
    console.log(`${label}: ${Date.now() - t0}ms — ${JSON.stringify(r).slice(0, 150)}`);
    return r;
  } catch (e) {
    console.log(`${label}: ABORT ${Date.now() - t0}ms — ${e.message}`);
    return null;
  }
}

console.log("=== single-ZIP probes ===");
await probe("count zip 06106", `SELECT COUNT(*)::int AS n FROM permits WHERE zip = '06106'`);
await probe("count zip 90001", `SELECT COUNT(*)::int AS n FROM permits WHERE zip = '90001'`);
await probe("count zip 78701", `SELECT COUNT(*)::int AS n FROM permits WHERE zip = '78701'`);

console.log("\n=== distinct zip count ===");
await probe("distinct zips", `SELECT COUNT(DISTINCT zip)::int AS n FROM permits WHERE zip IS NOT NULL`);

console.log("\n=== single ZIP full aggregate (volume only, no ILIKE) ===");
await probe("agg single", `
  SELECT '06106' as zip,
    COUNT(*) FILTER (WHERE COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '90 days')::int AS p90,
    COUNT(*) FILTER (WHERE COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '180 days')::int AS p180,
    COUNT(*) FILTER (WHERE COALESCE(issued_date, applied_date, created_at::date) >= NOW() - INTERVAL '365 days')::int AS p365
  FROM permits WHERE zip = '06106'
`);
