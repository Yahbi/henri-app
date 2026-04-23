/**
 * Phase 4 — Seed 60 owner territories across 20+ states.
 *
 * Picks top ZIPs by permit count within the last 30 days (so the map pins
 * actually show) and spreads coverage across states. Inserts directly into
 * `territories` with slot_number=1 (bypasses plan-limit check; this is dev
 * seed data).
 *
 * Run:  npx tsx scripts/seed-owner-territories.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const OWNER_EMAIL = "y.abismuth@gmail.com";
const TARGET_TOTAL = 60;
const MIN_STATES = 20;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  // 1. Resolve owner
  const { data: owner, error: ownerErr } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("email", OWNER_EMAIL)
    .single();
  if (ownerErr || !owner) {
    console.error("Owner not found:", ownerErr?.message);
    process.exit(1);
  }
  console.log(`Owner: ${owner.email} (${owner.id}, role=${owner.role})`);

  // 2. Find top ZIPs by recent permit count (last 30 days).
  // We don't have a canned SQL aggregate endpoint via PostgREST, so do the
  // aggregation in JS. Pull recent permits and count by (zip, state).
  console.log("Scanning recent permits…");
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const zipCounts = new Map<string, { zip: string; state: string; count: number }>();
  const PAGE = 1000;
  let offset = 0;
  let scanned = 0;
  while (true) {
    const { data, error } = await supabase
      .from("permits")
      .select("zip, state, issued_date, applied_date, created_at")
      .or(`issued_date.gte.${cutoff},applied_date.gte.${cutoff},created_at.gte.${cutoff}T00:00:00`)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ zip: string | null; state: string | null }>) {
      if (!r.zip || !r.state) continue;
      const k = `${r.state}_${r.zip}`;
      const entry = zipCounts.get(k);
      if (entry) entry.count += 1;
      else zipCounts.set(k, { zip: r.zip, state: r.state, count: 1 });
    }
    scanned += data.length;
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset > 200_000) break; // safety cap
  }
  console.log(`Scanned ${scanned} recent permits; ${zipCounts.size} unique ZIPs`);

  if (zipCounts.size === 0) {
    console.error(
      "No recent permits found. Run Phase 3a first, or widen the date cutoff.",
    );
    process.exit(1);
  }

  // 3. Pick ZIPs: first round-robin by state (one per state) until MIN_STATES
  //    reached; then top-up by overall count to hit TARGET_TOTAL.
  const sorted = [...zipCounts.values()].sort((a, b) => b.count - a.count);
  const pickedByState = new Map<string, typeof sorted[number][]>();
  for (const z of sorted) {
    const arr = pickedByState.get(z.state) ?? [];
    arr.push(z);
    pickedByState.set(z.state, arr);
  }

  const picked: typeof sorted[number][] = [];
  const pickedKeys = new Set<string>();
  // Round 1: one-per-state by descending-count state order
  const statesByTopZip = [...pickedByState.entries()].sort(
    (a, b) => b[1][0].count - a[1][0].count,
  );
  for (const [, arr] of statesByTopZip) {
    if (picked.length >= TARGET_TOTAL) break;
    const z = arr[0];
    picked.push(z);
    pickedKeys.add(`${z.state}_${z.zip}`);
  }
  // Round 2: top-up globally, skipping already-picked
  if (picked.length < TARGET_TOTAL) {
    for (const z of sorted) {
      if (picked.length >= TARGET_TOTAL) break;
      const k = `${z.state}_${z.zip}`;
      if (pickedKeys.has(k)) continue;
      picked.push(z);
      pickedKeys.add(k);
    }
  }
  const states = new Set(picked.map((p) => p.state));
  console.log(
    `Picked ${picked.length} ZIPs across ${states.size} states (top: ${picked
      .slice(0, 5)
      .map((p) => `${p.state}/${p.zip}(${p.count})`)
      .join(", ")})`,
  );

  // 4. Check existing territories for the owner — don't double-insert.
  const { data: existing } = await supabase
    .from("territories")
    .select("zip")
    .eq("contractor_id", owner.id);
  const existingZips = new Set((existing ?? []).map((t) => t.zip));

  // 5. Insert, one slot each, active.
  const now = new Date().toISOString();
  const rows = picked
    .filter((p) => !existingZips.has(p.zip))
    .map((p) => ({
      zip: p.zip,
      contractor_id: owner.id,
      status: "active" as const,
      slot_number: 1,
      claimed_at: now,
    }));
  console.log(
    `Inserting ${rows.length} new territories (skipped ${picked.length - rows.length} already owned)`,
  );

  let inserted = 0;
  for (const row of rows) {
    const { error } = await supabase.from("territories").insert(row);
    if (error) {
      // If slot 1 is taken by someone else, try slot 2 or 3
      if (/unique|duplicate/i.test(error.message)) {
        let filled = false;
        for (const slot of [2, 3]) {
          const { error: e2 } = await supabase
            .from("territories")
            .insert({ ...row, slot_number: slot });
          if (!e2) {
            filled = true;
            break;
          }
        }
        if (!filled) console.warn(`  skip ${row.zip}: all 3 slots taken`);
      } else {
        console.warn(`  skip ${row.zip}:`, error.message);
      }
    } else {
      inserted++;
    }
  }

  const { count: total } = await supabase
    .from("territories")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", owner.id);
  console.log(`Done. Inserted ${inserted} new; owner now holds ${total} territories.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
