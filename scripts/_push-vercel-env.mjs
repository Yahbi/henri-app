// Push the validated enrichment API keys into Vercel (Production + Preview).
//
// Reads:
//   - VERCEL_TOKEN from .env.local (you add this one line; create it at
//     https://vercel.com/account/tokens, scope: Full / the team)
//   - the KEY=VALUE lines from C:\Users\yabis\Desktop\henri-api-keys.txt
//
// No secrets live in this file — both are read from disk at runtime.
// Idempotent: uses upsert so re-running overwrites cleanly.
//
//   node scripts/_push-vercel-env.mjs            # push
//   node scripts/_push-vercel-env.mjs --dry-run  # show what would push

import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const PROJECT = "prj_DTQeuWNEhnWhDsLHZEdeEb13e2Qb";
const TEAM = "team_y6QIO0X0ebFEEb5AvNzGZ3SP";
const KEYS_FILE = "C:/Users/yabis/Desktop/henri-api-keys.txt";
const DRY = process.argv.includes("--dry-run");

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error(
    "VERCEL_TOKEN not found in .env.local.\n" +
      "Create one at https://vercel.com/account/tokens (scope: the team), then add\n" +
      "  VERCEL_TOKEN=xxxxx\n" +
      "to .env.local and re-run.",
  );
  process.exit(1);
}

// Only these enrichment vars are eligible to push from the keys file.
const ALLOWED = new Set([
  "NUMVERIFY_API_KEY",
  "CLOUDMERSIVE_API_KEY",
  "HUNTER_API_KEY",
  "WEATHERSTACK_API_KEY",
  "YELP_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "OPENCORPORATES_API_KEY",
  "FEC_API_KEY",
  "CL_TOKEN",
]);

const txt = readFileSync(KEYS_FILE, "utf8");
const pairs = [];
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
  if (m && ALLOWED.has(m[1]) && m[2].trim()) pairs.push([m[1], m[2].trim()]);
}

if (pairs.length === 0) {
  console.error("No eligible KEY=VALUE lines found in the keys file.");
  process.exit(1);
}

console.log(
  `Pushing ${pairs.length} env var(s) to henri-app (Production + Preview):`,
  pairs.map(([k]) => k).join(", "),
);
if (DRY) {
  console.log("--dry-run: not writing.");
  process.exit(0);
}

const base = `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}&upsert=true`;
let ok = 0;
for (const [key, value] of pairs) {
  const res = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview"],
    }),
  });
  if (res.ok) {
    console.log(`  set ${key}`);
    ok++;
  } else {
    const body = await res.text();
    console.log(`  FAILED ${key}: ${res.status} ${body.slice(0, 160)}`);
  }
}
console.log(`Done: ${ok}/${pairs.length} set. Trigger a redeploy for them to take effect.`);
