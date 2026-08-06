#!/usr/bin/env node
/**
 * Push never-scraped sources in UNCOVERED states to the front of the scrape
 * rotation.
 *
 * ─── Why this exists ────────────────────────────────────────────────────
 * Fixing the lane weave (src/lib/scrapers/sources-db.ts) lets the explorer
 * lane run at all, but it does not choose WHICH of the ~210,903 never-scraped
 * sources runs first. Left alone the queue drains in physical row order, which
 * has nothing to do with what Henri is missing — and a full rotation is months
 * of cron time. Coverage measured 2026-08-06:
 *
 *     9 states with ZERO permits   ME MI MN MT NH NV OK RI UT
 *     states under 500 ZIP-bearing permits, i.e. unsellable
 *     15,628 of ~41,000 US ZIPs covered
 *
 * A contractor cannot buy a ZIP that has no permits, so a source in an empty
 * state is worth far more than the 40,000th source in a state already covered.
 * This script encodes that: it reads live per-state permit counts, then sets
 * `priority = DISCOVERY_BOOST_PRIORITY` on enabled, never-scraped sources in
 * the states that need them.
 *
 * The boost is CONSUMED on the source's first healthy run (see
 * recordSourceRun) so a graduated source drops back to normal rotation. That
 * matters: leaving thousands of sources permanently boosted would rebuild the
 * starvation this whole effort exists to break, since both lanes order by
 * `priority DESC` before `last_scraped_at`.
 *
 * ─── Why counts are recomputed, never hardcoded ─────────────────────────
 * The empty-state list is a fact about the database on the day it is read, and
 * the whole point of the fix is that it changes. A hardcoded list would keep
 * boosting states that have since filled and ignore ones that regressed.
 *
 * ─── Load ───────────────────────────────────────────────────────────────
 * Bulk DML through the Supabase Management API took this database down on
 * 2026-08-04. Every write here is a bounded PostgREST UPDATE scoped to ONE
 * state at a time (largest observed bucket ~5k rows), which keeps each
 * statement inside the 8s PostgREST statement_timeout. Idempotent — re-running
 * only ever re-asserts the same priority.
 *
 * Run:  node scripts/prioritize-coverage-gaps.mjs [--dry-run]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Matches DISCOVERY_BOOST_PRIORITY in src/lib/scrapers/sources-db.ts. */
const BOOST = 1;

/**
 * A state needs help below this many ZIP-BEARING permits.
 *
 * ZIP-bearing, not raw: a permit with no ZIP cannot become a lead
 * (api/cron/score drops it), so raw counts overstate real coverage badly —
 * NJ holds 15k+ raw permits and 2 with a ZIP.
 *
 * 500 is the same threshold the landing-page coverage map uses to decide a
 * state is worth showing, so "boosted here" and "not claimed as covered"
 * stay the same set.
 */
const COVERED_THRESHOLD = 500;

/* ── env ────────────────────────────────────────────────────────────────── */
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
  console.error("Run `npx vercel env pull .env.local` first.");
  process.exit(1);
}

const DRY = process.argv.includes("--dry-run");
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** Exact row count via PostgREST's Content-Range header. */
async function count(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { ...HEADERS, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) throw new Error(`count ${path} -> HTTP ${res.status}`);
  return Number(res.headers.get("content-range").split("/")[1]);
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

/* ── 1. measure coverage, one state per statement ───────────────────────── */
// Deliberately 51 small queries rather than one GROUP BY: an aggregate across
// 3.38M permits is a ~37s parallel seq scan and trips the 8s ceiling. This is
// the same per-state fan-out /api/cron/refresh-landing-stats uses.
console.log(`Measuring ZIP-bearing permit coverage across ${STATES.length} states...\n`);

const coverage = [];
for (const state of STATES) {
  const zipped = await count(
    `permits?select=id&state=eq.${state}&zip=not.is.null&limit=1`,
  );
  coverage.push({ state, zipped });
}

const gaps = coverage
  .filter((c) => c.zipped < COVERED_THRESHOLD)
  .sort((a, b) => a.zipped - b.zipped);

console.log(`${gaps.length} states under ${COVERED_THRESHOLD} ZIP-bearing permits:`);
for (const g of gaps) {
  console.log(`  ${g.state}  ${String(g.zipped).padStart(7)}${g.zipped === 0 ? "   (empty)" : ""}`);
}

if (gaps.length === 0) {
  console.log("\nNo coverage gaps. Nothing to boost.");
  process.exit(0);
}

/* ── 2. count the candidate sources per gap state ───────────────────────── */
console.log("\nNever-scraped enabled sources available in those states:");
let candidateTotal = 0;
for (const g of gaps) {
  g.candidates = await count(
    `permit_sources?select=id&enabled=eq.true&last_scraped_at=is.null` +
      `&priority=eq.0&state=eq.${g.state}&limit=1`,
  );
  candidateTotal += g.candidates;
  if (g.candidates > 0) {
    console.log(`  ${g.state}  ${String(g.candidates).padStart(7)}`);
  }
}
console.log(`\n  total to boost: ${candidateTotal.toLocaleString()}`);

if (DRY) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

/* ── 3. boost, one bounded statement per state ──────────────────────────── */
console.log("\nApplying priority boost...");
let boosted = 0;
for (const g of gaps) {
  if (!g.candidates) continue;

  // Scoped to ONE state, and only to rows still at priority 0, so a re-run is
  // a no-op rather than a second full-table write.
  const res = await fetch(
    `${URL_}/rest/v1/permit_sources` +
      `?enabled=eq.true&last_scraped_at=is.null&priority=eq.0&state=eq.${g.state}`,
    {
      method: "PATCH",
      headers: { ...HEADERS, "Content-Type": "application/json", Prefer: "count=exact" },
      body: JSON.stringify({ priority: BOOST }),
    },
  );

  if (!res.ok) {
    console.error(`  ${g.state}  FAILED HTTP ${res.status}  ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const n = Number(res.headers.get("content-range")?.split("/")[1] ?? g.candidates);
  boosted += n;
  console.log(`  ${g.state}  ${String(n).padStart(7)} boosted`);
}

console.log(`\nBoosted ${boosted.toLocaleString()} sources to priority ${BOOST}.`);
console.log("They now lead the explorer lane. The boost clears on each source's");
console.log("first healthy run, so they fall back to normal rotation once proven.");
