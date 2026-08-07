#!/usr/bin/env node
/**
 * Drive the house-number-ZIP repair (migration 00141) to completion.
 *
 * ─── What is broken ─────────────────────────────────────────────────────
 * 139,317 permits and 67,394 leads store a `zip` that is byte-identical to
 * the leading house number of their own address — `"15310 W SUNSET BLVD"`
 * with zip `"15310"`. They are five digits, so every `/^\d{5}$/` validator
 * passes them. 48,333 of the leads are Californian with ZIPs in the
 * 10000-28158 range; California is 90001-96162.
 *
 * ZIP is the only key territory matching uses, so these rows are either
 * invisible to the contractor who covers that address, or delivered to one a
 * thousand miles away who is paying for the ZIP they collided with.
 *
 * The functions null the value rather than correcting it — a house number
 * carries no information about a postal code, so any derived ZIP would be
 * invented. NULL re-enters `/api/cron/census-geocode`, which resolves the
 * real one from the address at a measured 58% match rate.
 *
 * ─── Why paced ──────────────────────────────────────────────────────────
 * Bulk DML through the Management API took this database down on 2026-08-04.
 * Bounded statements alone are not enough — they still saturate the pool when
 * fired back to back. PACE_MS is the part that attempt was missing. Same
 * shape as scripts/run-objobj-repair.mjs, which drained 125,304 rows without
 * incident.
 *
 * Fully resumable: each RPC call re-selects its own next batch.
 *
 * Run:  node scripts/run-zip-repair.mjs [--batch=1000] [--pace=750]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const BATCH = arg("batch", 1000);
const PACE_MS = arg("pace", 750);
const MAX_CONSECUTIVE_ERRORS = 5;

function loadEnvLocal() {
  const out = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through to process.env */
  }
  return out;
}
const env = { ...loadEnvLocal(), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drain(fn, label) {
  console.log(`\n── ${label} ──`);
  let repaired = 0;
  let calls = 0;
  let consecutiveErrors = 0;
  const started = Date.now();

  for (;;) {
    const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ p_batch: BATCH }),
    });

    if (!res.ok) {
      consecutiveErrors += 1;
      console.error(`  call ${calls + 1}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`  stopping after ${MAX_CONSECUTIVE_ERRORS} consecutive failures — re-run to resume`);
        break;
      }
      // Back off harder on failure; a struggling pool needs more than the
      // normal pace, and this is exactly where the 08-04 run should have.
      await sleep(PACE_MS * 4);
      continue;
    }

    consecutiveErrors = 0;
    const fixed = Number(await res.json());
    calls += 1;
    repaired += fixed;

    if (fixed === 0) {
      console.log(`  drained after ${calls} calls`);
      break;
    }
    if (calls % 10 === 0) {
      console.log(`  ${repaired.toLocaleString()} repaired  ${calls} calls  ${Math.round((Date.now() - started) / 1000)}s`);
    }
    await sleep(PACE_MS);
  }

  console.log(`  ${label}: ${repaired.toLocaleString()} rows in ${Math.round((Date.now() - started) / 1000)}s`);
  return repaired;
}

console.log(`batch=${BATCH}  pace=${PACE_MS}ms`);
// Permits first: leads derive from them, so fixing the source before the
// derived rows keeps the two consistent if the run is interrupted.
const p = await drain("repair_house_number_zips", "permits");
const l = await drain("repair_house_number_zips_leads", "leads");

console.log(`\ntotal: ${(p + l).toLocaleString()} rows nulled`);
console.log("They now re-enter /api/cron/census-geocode, which resolves the");
console.log("real ZIP from the address. Once both read 0, drop the helper index:");
console.log("  DROP INDEX IF EXISTS public.idx_permits_housenum_zip_repair;");
