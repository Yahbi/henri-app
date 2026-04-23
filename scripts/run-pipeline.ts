#!/usr/bin/env npx tsx
/* ── Full Pipeline Runner ────────────────────────────────────────────────────
 * Runs the complete permit → lead pipeline in one command:
 *
 *   1. Ingest permits from SQLite (normalize, geocode, upload to Supabase)
 *   2. Trigger the scoring cron (create leads from permits, assign to contractors)
 *
 * Usage:
 *   npx tsx scripts/run-pipeline.ts [path-to-permits.db]
 *
 * Flags:
 *   --skip-geocode    Skip geocoding (faster, but leads won't show on map)
 *   --retry-failed    Retry failed geocodes individually (slower but more coverage)
 *   --skip-score      Only ingest, don't trigger scoring
 *   --production      Target deployed app instead of localhost for scoring
 *
 * Requires:
 *   - .env.local with Supabase credentials
 *   - Next.js dev server running for scoring (unless --skip-score)
 * ────────────────────────────────────────────────────────────────────────── */

import { execSync } from "child_process";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const args = process.argv.slice(2);

// Separate DB path from flags
const dbPath = args.find((a) => !a.startsWith("--"));
const flags = args.filter((a) => a.startsWith("--"));
const skipScore = flags.includes("--skip-score");

function run(cmd: string, label: string) {
  console.log(`\n${"#".repeat(60)}`);
  console.log(`# ${label}`);
  console.log(`${"#".repeat(60)}\n`);

  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, FORCE_COLOR: "1" },
    });
  } catch {
    console.error(`\n${label} failed.`);
    process.exit(1);
  }
}

/* ── Step 1: Ingest ──────────────────────────────────────────────────────── */

const ingestFlags = flags
  .filter((f) => ["--skip-geocode", "--retry-failed"].includes(f))
  .join(" ");

const ingestCmd = dbPath
  ? `npx tsx scripts/ingest-permits.ts "${dbPath}" ${ingestFlags}`
  : `npx tsx scripts/ingest-permits.ts ${ingestFlags}`;

run(ingestCmd.trim(), "Step 1/2: Ingest Permits");

/* ── Step 2: Score ──────────────────────────────────────────────────────── */

if (skipScore) {
  console.log("\n  Scoring skipped (--skip-score flag).");
  console.log("  Run manually: npx tsx scripts/trigger-score.ts");
} else {
  const scoreFlags = flags.includes("--production") ? "--production" : "";
  run(`npx tsx scripts/trigger-score.ts ${scoreFlags}`.trim(), "Step 2/2: Score & Assign Leads");
}

console.log(`\n${"=".repeat(60)}`);
console.log("  Full pipeline complete");
console.log(`${"=".repeat(60)}`);
