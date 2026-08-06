#!/usr/bin/env node
/**
 * Drive the batched `[object Object]` address repair to completion.
 *
 * ─── What is broken ─────────────────────────────────────────────────────
 * The Socrata scraper once assigned a `location` OBJECT straight into the
 * text `address` column, so JS stringified it. 126,754 permits carry the
 * literal text '[object Object]' as their address, with NULL zip / lat / lng.
 * They are invisible to territory matching and can never become a lead — and
 * `raw_json` holds everything needed to rebuild them (address_start,
 * street_*, zip_code, location_1.coordinates).
 *
 * ─── Why a paced loop and not one UPDATE ────────────────────────────────
 * This exact repair took the database down on 2026-08-04. It was run as
 * 10k-25k-row UPDATEs through the Supabase Management API; that saturated the
 * connection pool, PostgREST started returning PGRST002 ("could not query the
 * database for the schema cache"), and the whole data layer was unavailable
 * for ~10 minutes while the project still reported ACTIVE_HEALTHY.
 *
 * Migration 00120 exposes `repair_objobj_permits(p_batch)`, which does ONE
 * bounded batch per call and returns the number of rows it fixed. This script
 * is the caller. Two rules make it safe, and both matter:
 *
 *   1. BATCH is small enough that each call is comfortably inside the 8s
 *      PostgREST statement_timeout.
 *   2. PACE_MS of idle between calls. This is the part the outage was missing
 *      — bounded statements still saturate a pool if fired back to back.
 *
 * Fully resumable: the function selects its own next batch, so re-running
 * after any interruption continues rather than repeating. Stops on the first
 * call that repairs zero rows.
 *
 * Run:  node scripts/run-objobj-repair.mjs [--batch=1000] [--pace=750]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

/** Rows per RPC call. 1000 measured well inside the 8s statement budget. */
const BATCH = arg("batch", 1000);
/** Idle milliseconds between calls — the safeguard the 08-04 attempt lacked. */
const PACE_MS = arg("pace", 750);
/** Consecutive failures tolerated before giving up. */
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

async function remaining() {
  const res = await fetch(
    `${URL_}/rest/v1/permits?select=id&address=eq.${encodeURIComponent("[object Object]")}`,
    { headers: { ...HEADERS, Prefer: "count=exact", Range: "0-0" } },
  );
  if (!res.ok) return null;
  return Number(res.headers.get("content-range").split("/")[1]);
}

const before = await remaining();
console.log(`[object Object] permits remaining: ${before?.toLocaleString() ?? "unknown"}`);
console.log(`batch=${BATCH}  pace=${PACE_MS}ms\n`);

if (!before) {
  console.log("Nothing to repair.");
  process.exit(0);
}

let repaired = 0;
let calls = 0;
let consecutiveErrors = 0;
const started = Date.now();

for (;;) {
  const res = await fetch(`${URL_}/rest/v1/rpc/repair_objobj_permits`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ p_batch: BATCH }),
  });

  if (!res.ok) {
    consecutiveErrors += 1;
    const body = (await res.text()).slice(0, 200);
    console.error(`  call ${calls + 1}: HTTP ${res.status} ${body}`);
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`\nStopping after ${MAX_CONSECUTIVE_ERRORS} consecutive failures.`);
      console.error("Re-run to resume — the function picks its own next batch.");
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
    console.log(`\nQueue drained after ${calls} calls.`);
    break;
  }

  if (calls % 10 === 0) {
    const secs = Math.round((Date.now() - started) / 1000);
    const pct = before ? Math.round((repaired / before) * 100) : 0;
    console.log(`  ${repaired.toLocaleString()} repaired (${pct}%)  ${calls} calls  ${secs}s`);
  }

  await sleep(PACE_MS);
}

const after = await remaining();
console.log(`\nrepaired this run : ${repaired.toLocaleString()}`);
console.log(`remaining          : ${after?.toLocaleString() ?? "unknown"}`);
console.log(`elapsed            : ${Math.round((Date.now() - started) / 1000)}s`);
if (after === 0) {
  console.log("\nDone. Next: drop idx_permits_objobj_repair (it existed only to");
  console.log("make these batches index-scannable) and re-run refresh-landing-stats.");
}
