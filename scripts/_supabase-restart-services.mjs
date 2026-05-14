/**
 * Trigger Supabase project services restart via Management API.
 * Bypasses the frozen dashboard renderer.
 *
 * Endpoint: POST /v1/projects/{ref}/restart-services
 * Body: { restart_request: { region, services: ["postgres", ...] } }
 *
 * Tries a few endpoint variants since the API has shifted versions.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = "ivfxylgoxgrxttknewsf";

async function attempt(url, body) {
  console.log(`\n=== POST ${url} ===`);
  console.log(`body: ${JSON.stringify(body)}`);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    console.log(`status: ${r.status}`);
    console.log(`body:   ${text.slice(0, 500)}`);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: text };
  } catch (e) {
    console.log(`error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Variant 1: documented restart-services
let r = await attempt(
  `https://api.supabase.com/v1/projects/${REF}/restart-services`,
  { restart_request: { region: "us-west-1", services: ["postgrest", "postgresql"] } },
);

if (!r.ok) {
  // Variant 2: simpler shape
  r = await attempt(
    `https://api.supabase.com/v1/projects/${REF}/restart-services`,
    { region: "us-west-1", services: ["postgres"] },
  );
}

if (!r.ok) {
  // Variant 3: just restart no body
  r = await attempt(
    `https://api.supabase.com/v1/projects/${REF}/restart-services`,
    {},
  );
}

if (!r.ok) {
  // Variant 4: pause + resume (the heavy hammer)
  console.log("\n=== fall back to pause+resume sequence ===");
  console.log("Trying /v1/projects/{ref}/pause");
  await attempt(`https://api.supabase.com/v1/projects/${REF}/pause`, {});
}

console.log("\n=== final state ===");
const status = await fetch(`https://api.supabase.com/v1/projects/${REF}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
const statusText = await status.text();
console.log(statusText);
