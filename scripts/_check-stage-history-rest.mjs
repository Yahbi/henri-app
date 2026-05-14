/**
 * Probe via PostgREST instead of Mgmt API (different ingress, often
 * succeeds when Mgmt API is connection-pool exhausted).
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(p) {
  const r = await fetch(`${URL}/rest/v1/${p}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=exact",
    },
  });
  return { status: r.status, body: await r.json(), count: r.headers.get("content-range") };
}

console.log("=== count via PostgREST ===");
const r = await rest("stage_history?select=lead_id&limit=1");
console.log("status:", r.status);
console.log("content-range:", r.count);
console.log("body:", JSON.stringify(r.body));

console.log("\n=== sample 5 backfill rows ===");
const s = await rest("stage_history?select=lead_id,to_stage,changed_by_kind&changed_by_kind=eq.backfill&limit=5");
console.log("status:", s.status);
console.log("body:", JSON.stringify(s.body, null, 2));
