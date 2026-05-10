/**
 * Programmatic compute-tier upgrade via the Mgmt API addons endpoint.
 * Pro tier already pays for Micro; current instance is Nano.
 *
 * Trying these endpoints (none publicly documented for compute):
 *   POST /v1/projects/{ref}/billing/addons
 *   PATCH /v1/projects/{ref}/database/postgres-config
 *   POST /v1/projects/{ref}/upgrade
 *
 * Some of these will 404 — that just rules them out. We're hunting
 * for whichever endpoint Supabase's dashboard internally calls.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "ivfxylgoxgrxttknewsf";

async function call(method, path, body) {
  console.log(`\n=== ${method} ${path} ===`);
  if (body) console.log(`body: ${JSON.stringify(body)}`);
  try {
    const r = await fetch(`https://api.supabase.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    console.log(`status: ${r.status}`);
    console.log(`body:   ${text.slice(0, 600)}`);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text };
  } catch (e) {
    console.log(`error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// 1) See current addons (read-only, learn the shape)
await call("GET", `/v1/projects/${REF}/billing/addons`);

// 2) Try the compute upgrade addon
await call("POST", `/v1/projects/${REF}/billing/addons`, {
  addon_type: "compute_instance",
  addon_variant: "ci_micro",
});

// 3) Alternative: just `compute` namespace
await call("PATCH", `/v1/projects/${REF}/database/postgres-config`, {
  compute_size: "micro",
});

// 4) Final: status check
await call("GET", `/v1/projects/${REF}`);
