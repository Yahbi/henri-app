#!/usr/bin/env npx tsx
/* ── Trigger Scoring Cron ────────────────────────────────────────────────────
 * Calls the /api/cron/score endpoint on the local (or deployed) Next.js
 * server to convert unscored permits into scored leads.
 *
 * Usage:
 *   npx tsx scripts/trigger-score.ts              # local dev server
 *   npx tsx scripts/trigger-score.ts --production # deployed app
 *
 * Requires:
 *   - CRON_SECRET env var (loaded from .env.local)
 *   - Next.js dev server running (npm run dev) for local mode
 * ────────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

const IS_PRODUCTION = process.argv.includes("--production");
const BASE_URL = IS_PRODUCTION
  ? (process.env.NEXT_PUBLIC_APP_URL || "https://henriapp.com")
  : "http://localhost:3000";

const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error("CRON_SECRET not found in .env.local");
  process.exit(1);
}

async function triggerScoring() {
  const url = `${BASE_URL}/api/cron/score`;

  console.log("=".repeat(60));
  console.log("  Henri — Trigger Lead Scoring");
  console.log("=".repeat(60));
  console.log(`\n  Target: ${url}`);
  console.log(`  Mode: ${IS_PRODUCTION ? "PRODUCTION" : "local dev"}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      signal: AbortSignal.timeout(300_000), // 5 minute timeout
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`\n  Scoring failed (${response.status}): ${body}`);
      process.exit(1);
    }

    const result = await response.json();

    console.log("\n  Scoring complete:");
    console.log(JSON.stringify(result, null, 2));

    if (result.summary) {
      const s = result.summary;
      console.log(`\n  Results:`);
      console.log(`    Permits scored:    ${s.scored}`);
      console.log(`    Leads created:     ${s.leadsCreated}`);
      console.log(`    Assigned:          ${s.assigned}`);
      console.log(`    Notified:          ${s.notified}`);
      if (s.scoreDistribution) {
        console.log(`    Hot leads:         ${s.scoreDistribution.hot}`);
        console.log(`    Warm leads:        ${s.scoreDistribution.warm}`);
        console.log(`    Cool leads:        ${s.scoreDistribution.cool}`);
        console.log(`    Cold leads:        ${s.scoreDistribution.cold}`);
      }
      if (s.avgScore) {
        console.log(`    Average score:     ${s.avgScore}/100`);
      }
    }
  } catch (err) {
    if (err instanceof TypeError && String(err).includes("fetch failed")) {
      console.error(`\n  Could not connect to ${BASE_URL}`);
      console.error("  Make sure the Next.js dev server is running: npm run dev");
      console.error("  Or use --production to target the deployed app.");
    } else {
      console.error("\n  Error:", err);
    }
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Done");
  console.log("=".repeat(60));
}

triggerScoring();
