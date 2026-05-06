/**
 * Pull production env vars from Vercel into .env.local for local dev parity.
 *
 * Why this exists:
 *   - Henri's prod env has 16 vars (Supabase, Stripe live, OpenAI, Resend, etc.)
 *   - Local dev needs the same vars for `pnpm dev` to work the same as prod
 *   - Vercel CLI's `vercel env pull` does this but assumes the CLI is installed
 *   - This script does the same via direct REST API calls so it works without
 *     a global Node install (we hit the same problem during launch)
 *
 * Usage:
 *   VERCEL_TOKEN=vcp_... npx tsx scripts/_sync-env-local.ts
 *
 *   Or set VERCEL_TOKEN in your shell profile (NOT in .env.local — chicken/egg).
 *
 * What it does:
 *   1. List all env vars on the henri-app Vercel project (gets IDs + types)
 *   2. For each var, fetch the per-id endpoint with `?decrypt=true` (the
 *      bulk endpoint returns encrypted blobs for type=encrypted; the per-id
 *      endpoint returns plaintext when authorized).
 *   3. Override NEXT_PUBLIC_APP_URL to http://localhost:3000 for dev parity
 *   4. Write to .env.local with section headers + dev-only flags
 *   5. Back up any existing .env.local to .env.local.bak
 *
 * Re-run anytime after rotating a secret in Vercel UI to keep local in sync.
 *
 * This file is gitignored (see .gitignore — `/scripts/_*.ts` pattern).
 */
import * as fs from "fs";
import * as path from "path";

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID =
  process.env.VERCEL_PROJECT_ID ?? "prj_DTQeuWNEhnWhDsLHZEdeEb13e2Qb";

if (!VERCEL_TOKEN) {
  console.error(
    "Missing VERCEL_TOKEN. Set it in your shell:\n" +
    "  Windows PowerShell: $env:VERCEL_TOKEN='vcp_...'\n" +
    "  bash:               export VERCEL_TOKEN=vcp_...\n",
  );
  process.exit(1);
}

interface VercelEnvListItem {
  id: string;
  key: string;
  type: "plain" | "encrypted" | string;
  target: string[];
  value?: string;
}

interface VercelEnvDetail extends VercelEnvListItem {
  value: string;
}

const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_LOCAL = path.join(REPO_ROOT, ".env.local");
const ENV_LOCAL_BAK = `${ENV_LOCAL}.bak`;

const SECTIONS: Array<[string, string[]]> = [
  ["Supabase", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]],
  ["App", ["NEXT_PUBLIC_APP_URL", "CRON_SECRET"]],
  ["Stripe (LIVE mode)", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_FOUNDER_PRICE_ID", "STRIPE_STARTER_PRICE_ID", "STRIPE_PRO_PRICE_ID", "STRIPE_ENTERPRISE_PRICE_ID"]],
  ["AI / Comms", ["OPENAI_API_KEY", "RESEND_API_KEY"]],
  ["Maps", ["NEXT_PUBLIC_MAPBOX_TOKEN"]],
  ["Feature flags", ["WRITE_PROVENANCE", "WRITE_EXTENDED"]],
];

const DEV_OVERRIDES: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const DEV_ONLY_EXTRAS: Array<[string, string, string]> = [
  ["NEXT_PUBLIC_ENABLE_DEV_LOGIN", "1", "Enable god-mode auto-login button on /login (gated env-side; never set in prod)"],
];

async function vercel<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function main() {
  console.log("── Sync Vercel env → .env.local ──────────────");

  console.log("\n[1/3] Listing env vars...");
  const list = await vercel<{ envs: VercelEnvListItem[] }>(
    `/v9/projects/${PROJECT_ID}/env?decrypt=true`,
  );
  console.log(`  found ${list.envs.length} env vars`);

  console.log("\n[2/3] Fetching decrypted values...");
  const fetched: Record<string, string> = {};
  for (const item of list.envs) {
    const detail = await vercel<VercelEnvDetail>(
      `/v1/projects/${PROJECT_ID}/env/${item.id}`,
    );
    fetched[item.key] = detail.value;
    console.log(`  ✓ ${item.key.padEnd(36)} (${detail.value.length} chars)`);
  }

  console.log("\n[3/3] Writing .env.local...");
  if (fs.existsSync(ENV_LOCAL)) {
    const existing = fs.readFileSync(ENV_LOCAL, "utf-8");
    if (existing.trim()) {
      fs.writeFileSync(ENV_LOCAL_BAK, existing);
      console.log(`  • backed up existing .env.local → .env.local.bak`);
    }
  }

  const lines: string[] = [];
  lines.push(`# Auto-pulled from Vercel production env vars (${new Date().toISOString()})`);
  lines.push(`# .env.local is gitignored — never commit this file`);
  lines.push(`# To re-sync: VERCEL_TOKEN=vcp_... npx tsx scripts/_sync-env-local.ts`);
  lines.push("");

  for (const [section, keys] of SECTIONS) {
    lines.push(`# --- ${section} ---`);
    for (const key of keys) {
      const value = DEV_OVERRIDES[key] ?? fetched[key];
      if (value !== undefined) {
        lines.push(`${key}=${value}`);
      }
    }
    lines.push("");
  }

  lines.push(`# --- Dev-only ---`);
  for (const [key, value, desc] of DEV_ONLY_EXTRAS) {
    if (desc) lines.push(`# ${desc}`);
    lines.push(`${key}=${value}`);
  }
  lines.push("");

  fs.writeFileSync(ENV_LOCAL, lines.join("\n"));
  console.log(`  ✓ wrote ${list.envs.length} prod vars + ${DEV_ONLY_EXTRAS.length} dev flags`);
  console.log(`    NEXT_PUBLIC_APP_URL overridden to ${DEV_OVERRIDES.NEXT_PUBLIC_APP_URL}`);

  console.log("\n── Done ──");
  console.log(`\nNext: pnpm dev → http://localhost:3000`);
  console.log("  /login → Continue with Google should now work locally");
  console.log("  (Supabase URL Configuration already includes http://localhost:3000/**)");
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
