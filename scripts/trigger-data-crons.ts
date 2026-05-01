#!/usr/bin/env npx tsx
/* ── Trigger data-acquisition crons (Wave 1 / 2.A / 2.B Phase 1) ────────────
 * One-shot manual trigger for every cron under /api/cron that pulls a
 * sidecar canonical-data-layer table. Useful right after a deploy to
 * fill the new tables without waiting 24h–7d for the natural schedule.
 *
 * Usage:
 *   pnpm tsx scripts/trigger-data-crons.ts                  # production
 *   pnpm tsx scripts/trigger-data-crons.ts --local          # localhost:3000
 *   pnpm tsx scripts/trigger-data-crons.ts --only swdi,gdelt
 *
 * Requires CRON_SECRET in .env.local. Crons run sequentially with a
 * short pause between calls so we don't blow up free-tier quotas on
 * the upstream APIs (FEMA / Census / CDC throttle anonymous bursts).
 * ────────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "..", ".env.local") });

const IS_LOCAL = process.argv.includes("--local");
const ONLY = (() => {
  const idx = process.argv.indexOf("--only");
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v) return null;
  return new Set(v.split(",").map((s) => s.trim().toLowerCase()));
})();

const BASE_URL = IS_LOCAL
  ? "http://localhost:3000"
  : (process.env.NEXT_PUBLIC_APP_URL || "https://meethenri.com");

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("ERROR: CRON_SECRET not in .env.local");
  process.exit(1);
}

interface CronTask {
  key: string;
  path: string;
  wave: string;
  description: string;
}

const TASKS: CronTask[] = [
  // Wave 1 — already deployed
  { key: "swdi",            path: "/api/cron/swdi-events",           wave: "1",   description: "NOAA SWDI hail/wind/tornado (7-day)" },
  { key: "courtlistener",   path: "/api/cron/courtlistener-liens",   wave: "1",   description: "CourtListener mechanic-lien dockets (30-day)" },
  { key: "usgs",            path: "/api/cron/usgs-quakes",           wave: "1",   description: "USGS earthquakes (7-day, M2.5+)" },
  { key: "hud-reo",         path: "/api/cron/hud-reo",               wave: "1",   description: "HUD FHA REO foreclosures (full)" },
  { key: "census-geocode",  path: "/api/cron/census-geocode",        wave: "1",   description: "Census batch geocoder (5k permits/run)" },
  // Wave 2.A — risk + demographics
  { key: "fema-nri",        path: "/api/cron/fema-nri",              wave: "2.A", description: "FEMA NRI county+tract (~87k rows)" },
  { key: "cdc-svi",         path: "/api/cron/cdc-svi",               wave: "2.A", description: "CDC SVI by tract (~73k rows)" },
  { key: "census-acs",      path: "/api/cron/census-acs",            wave: "2.A", description: "Census ACS 5-yr 7 vars × 33k ZCTAs" },
  // Wave 2.B Phase 1 — disasters + news + mortgages
  { key: "openfema",        path: "/api/cron/openfema-declarations", wave: "2.B.1", description: "FEMA disaster declarations (~70k)" },
  { key: "gdelt",           path: "/api/cron/gdelt-triggers",        wave: "2.B.1", description: "GDELT construction-trigger news (7-day)" },
  { key: "hmda",            path: "/api/cron/hmda-rotate",           wave: "2.B.1", description: "HMDA Modified LAR (today's state, year=last-full)" },
  // Wave 2.B Phase 2 — federal claims + crosswalks + license rosters
  { key: "nfip",            path: "/api/cron/openfema-nfip",         wave: "2.B.2", description: "FEMA NFIP claims (today's year)" },
  { key: "ia",              path: "/api/cron/openfema-ia",           wave: "2.B.2", description: "FEMA IA valid registrations (today's disaster)" },
  { key: "hud-zipxw",       path: "/api/cron/hud-zipxw",             wave: "2.B.2", description: "HUD ZIP crosswalk Tract/Place/CBSA/County (~320k)" },
  { key: "state-licenses",  path: "/api/cron/state-licenses-rotate", wave: "2.B.2", description: "State contractor licensing board (today's state)" },
];

interface RunResult {
  task: CronTask;
  status: number;
  durationMs: number;
  body: unknown;
  error?: string;
}

async function runOne(task: CronTask): Promise<RunResult> {
  const url = `${BASE_URL}${task.path}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(295_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* leave as text */ }
    return {
      task,
      status: res.status,
      durationMs: Date.now() - startedAt,
      body,
    };
  } catch (err) {
    return {
      task,
      status: 0,
      durationMs: Date.now() - startedAt,
      body: null,
      error: String(err),
    };
  }
}

function summarizeBody(body: unknown): string {
  if (body == null) return "—";
  if (typeof body !== "object") return String(body).slice(0, 120);
  const o = body as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["pulled", "inserted", "parsed", "matched", "geocoded", "duration_ms", "state", "year", "data_year", "survey_year", "note"]) {
    if (o[k] !== undefined) parts.push(`${k}=${JSON.stringify(o[k])}`);
  }
  if (parts.length === 0) {
    parts.push(JSON.stringify(o).slice(0, 120));
  }
  return parts.join(" ");
}

async function main() {
  const tasks = ONLY ? TASKS.filter((t) => ONLY.has(t.key.toLowerCase())) : TASKS;
  console.log("=".repeat(72));
  console.log(`  Henri — data-acquisition cron trigger`);
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Tasks:   ${tasks.length} of ${TASKS.length}`);
  console.log("=".repeat(72));

  const results: RunResult[] = [];
  for (const t of tasks) {
    const tag = `[wave ${t.wave}] ${t.key.padEnd(16)}`;
    process.stdout.write(`\n${tag}  GET ${t.path}\n  ${t.description}\n`);
    const r = await runOne(t);
    const ok = r.status >= 200 && r.status < 300;
    const status = r.error ? `ERR  ${r.error}` : `${r.status}`;
    console.log(`  -> ${ok ? "ok" : "fail"}  http=${status}  ${(r.durationMs / 1000).toFixed(1)}s  ${summarizeBody(r.body)}`);
    results.push(r);
    // Polite 2s pause between calls so upstream APIs don't rate-limit us across the suite.
    await new Promise((res) => setTimeout(res, 2000));
  }

  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const fail = results.length - ok;
  console.log("\n" + "=".repeat(72));
  console.log(`  Summary:  ${ok} ok, ${fail} failed`);
  console.log("=".repeat(72));
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("trigger-data-crons fatal:", err);
  process.exit(1);
});
