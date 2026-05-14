/**
 * Verify Phase AA-3 schema state via PostgREST (avoids the
 * Management API + Cloudflare 524 path).
 *
 *   1. zip_pre_intent_aggregates exists + has rows
 *   2. leads.source column exists (test by inserting a row with that
 *      field — but actually a SELECT for the column suffices)
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(pathAndQuery, opts = {}) {
  const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=exact",
      ...opts.headers,
    },
    ...opts,
  });
  let body;
  try {
    body = await r.json();
  } catch {
    body = await r.text();
  }
  return { status: r.status, body, contentRange: r.headers.get("content-range") };
}

console.log("=== zip_pre_intent_aggregates ===");
const r1 = await rest(
  "zip_pre_intent_aggregates?select=zip,adu_90d,remodel_180d,permits_365d&order=permits_365d.desc&limit=5",
);
console.log("status:", r1.status);
console.log("count (header):", r1.contentRange);
console.log("top 5:", JSON.stringify(r1.body, null, 2));

console.log("\n=== ADU-active ZIPs ===");
const r2 = await rest(
  "zip_pre_intent_aggregates?select=zip,adu_90d&adu_90d=gte.3&order=adu_90d.desc&limit=10",
);
console.log("count (header):", r2.contentRange);
console.log("rows:", JSON.stringify(r2.body, null, 2));

console.log("\n=== leads.source distribution ===");
const r3 = await rest("leads?select=source&limit=1");
console.log("status:", r3.status);
if (r3.status === 200) {
  console.log("source column exists ✓");
} else {
  console.log("body:", JSON.stringify(r3.body));
}
