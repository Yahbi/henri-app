/**
 * Verify zip_pre_intent_aggregates via the PostgREST endpoint (which
 * has a different ingress than Management API + doesn't trip the
 * Cloudflare 524 timeout the same way on heavy reads).
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(pathAndQuery) {
  const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=exact",
    },
  });
  return { status: r.status, body: await r.json(), headers: Object.fromEntries(r.headers) };
}

console.log("=== count + first 10 rows ===");
const r1 = await rest("zip_pre_intent_aggregates?select=zip,adu_90d,remodel_180d,yoy_growth,permits_365d&order=permits_365d.desc&limit=10");
console.log("status:", r1.status);
console.log("content-range:", r1.headers["content-range"]);
console.log("rows:", JSON.stringify(r1.body, null, 2));

console.log("\n=== ADU-active ZIPs (adu_90d >= 3) ===");
const r2 = await rest("zip_pre_intent_aggregates?select=zip,adu_90d,remodel_180d&adu_90d=gte.3&order=adu_90d.desc&limit=10");
console.log("status:", r2.status);
console.log("rows:", JSON.stringify(r2.body, null, 2));

console.log("\n=== Remodel-active ZIPs (remodel_180d >= 5) ===");
const r3 = await rest("zip_pre_intent_aggregates?select=zip,remodel_180d,permits_365d&remodel_180d=gte.5&order=remodel_180d.desc&limit=10");
console.log("status:", r3.status);
console.log("rows:", JSON.stringify(r3.body, null, 2));
