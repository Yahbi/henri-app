/**
 * Probe Supabase Management API for project-level state. The /v1/projects/<ref>
 * endpoint returns { id, name, status, ... } and works even when /database/query
 * is timing out — it doesn't go through Postgres.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "ivfxylgoxgrxttknewsf";

async function fetchJson(url, opts = {}) {
  try {
    const r = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${TOKEN}`, ...opts.headers },
      signal: AbortSignal.timeout(15000),
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { abort: e.message };
  }
}

console.log("=== project metadata ===");
const r = await fetchJson(`https://api.supabase.com/v1/projects/${REF}`);
console.log(JSON.stringify(r, null, 2));

console.log("\n=== compute size (size endpoint) ===");
const r2 = await fetchJson(
  `https://api.supabase.com/v1/projects/${REF}/database/query`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "SELECT 1 AS up" }),
  },
);
console.log(JSON.stringify(r2));
