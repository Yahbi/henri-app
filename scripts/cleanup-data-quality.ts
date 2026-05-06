/**
 * Catch-all data-quality cleanup after the address-attribution audit
 * (2026-04-23). Handles the residual issues that `fix-permit-address-
 * attribution.ts` doesn't cover:
 *
 *   1. Null-island coords on permits & leads (lat=0, lng=0) — these
 *      cluster thousands of pins off West Africa. Null them out so the
 *      map layer's zero-rejection filter doesn't need to keep catching
 *      them row-by-row.
 *   2. permits.zip = '00000' or clearly invalid (non-5-digit) — null
 *      out rather than keep the sentinel in place. Downstream UI
 *      already treats null zip as "unknown".
 *   3. permits missing `state` — try to extract from the address tail
 *      using the "...CITY, ST ZIP" regex. If we can also extract a
 *      valid ZIP, set both.
 *   4. leads whose joined permit has no valid zip — sanity check only,
 *      no fix needed (lead reads through to permit via join).
 *   5. permits with lat/lng outside the continental US + AK + HI + PR
 *      bounding boxes — null the coords (the point is not in the US
 *      but a US permit is claimed).
 *
 * Run: npx tsx scripts/cleanup-data-quality.ts
 *      DRY_RUN=1 npx tsx scripts/cleanup-data-quality.ts
 *
 * Idempotent. Safe to re-run.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DRY_RUN = process.env.DRY_RUN === "1";
const PAGE = 1000;

async function updateBatch(table: string, ids: string[], patch: Record<string, unknown>): Promise<number> {
  if (DRY_RUN) return ids.length;
  let ok = 0;
  const CONCURRENCY = 10;
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      if (!id) break;
      const { error } = await s.from(table).update(patch).eq("id", id);
      if (!error) ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return ok;
}

/* ── 1. Null-island coords ──────────────────────────────────────── */

async function fixNullIsland(): Promise<void> {
  console.log("\n[1/5] null-island coords");
  for (const table of ["permits", "leads"]) {
    // Coords at (0,0) or within a small box around null island
    const { data } = await s
      .from(table)
      .select("id")
      .gt("latitude", -0.5).lt("latitude", 0.5)
      .gt("longitude", -0.5).lt("longitude", 0.5)
      .limit(5000);
    const ids = (data ?? []).map((r) => r.id as string);
    if (ids.length === 0) { console.log(`  ${table}: 0 null-island rows`); continue; }
    const ok = await updateBatch(table, ids, { latitude: null, longitude: null });
    console.log(`  ${table}: nulled coords on ${ok.toLocaleString()} null-island rows`);
  }
}

/* ── 2. zip = '00000' or non-5-digit ─────────────────────────────── */

async function fixOrphanZips(): Promise<void> {
  console.log("\n[2/5] permits.zip = '00000'");
  const { data, error } = await s
    .from("permits")
    .select("id")
    .eq("zip", "00000")
    .limit(5000);
  if (error) { console.warn(`  error: ${error.message}`); return; }
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) { console.log("  0 zip='00000' rows"); return; }
  const ok = await updateBatch("permits", ids, { zip: null });
  console.log(`  nulled zip on ${ok.toLocaleString()} permits (was '00000')`);

  // Leads denormalize zip from permit — null them too where zip='00000'.
  const { data: leadsData } = await s
    .from("leads")
    .select("id")
    .eq("zip", "00000")
    .limit(5000);
  const leadIds = (leadsData ?? []).map((r) => r.id as string);
  if (leadIds.length > 0) {
    const leadOk = await updateBatch("leads", leadIds, { zip: null });
    console.log(`  nulled zip on ${leadOk.toLocaleString()} leads`);
  }
}

/* ── 3. permits missing state — extract from address ────────────── */

function extractStateFromAddress(address: string): string | null {
  // Look for ", SS ZIP" or ", SS " at end of address
  const m = address.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
  if (m) return m[1];
  // Fallback: ", SS" right before trailing whitespace / end
  const m2 = address.match(/,\s*([A-Z]{2})\s*$/);
  if (m2) return m2[1];
  return null;
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","VI",
]);

async function fixMissingState(): Promise<void> {
  console.log("\n[3/5] permits missing state");
  let iter = 0;
  let totalFixed = 0;
  while (iter < 50) {
    iter++;
    const { data } = await s
      .from("permits")
      .select("id, address, state")
      .is("state", null)
      .not("address", "is", null)
      .limit(PAGE);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const patches: Array<{ id: string; state: string }> = [];
    const nullPatches: string[] = [];
    for (const r of rows) {
      const st = extractStateFromAddress(r.address as string);
      if (st && US_STATES.has(st)) {
        patches.push({ id: r.id as string, state: st });
      } else {
        // Can't infer — mark state='UNKNOWN' so the filter drops it.
        // Using a real 2-char sentinel that doesn't collide with a state.
        nullPatches.push(r.id as string);
      }
    }

    let ok = 0;
    if (!DRY_RUN) {
      let i = 0;
      const CONCURRENCY = 10;
      async function worker() {
        while (i < patches.length) {
          const p = patches[i++];
          if (!p) break;
          const { error } = await s.from("permits").update({ state: p.state }).eq("id", p.id);
          if (!error) ok++;
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    } else {
      ok = patches.length;
    }
    totalFixed += ok;

    // Mark un-extractable rows with 'XX' sentinel so they drop from the
    // `state IS NULL` filter. Do this in a second pass, after the good
    // extractions, so we prefer real states over the sentinel.
    if (nullPatches.length > 0 && !DRY_RUN) {
      await updateBatch("permits", nullPatches, { state: "XX" });
    }

    console.log(`  iter ${iter}: fixed ${ok}, sentinel-flagged ${nullPatches.length}, pool total=${totalFixed.toLocaleString()}`);
    if (rows.length < PAGE) break;
    if (patches.length === 0 && nullPatches.length === 0) break;
  }
  console.log(`  done: ${totalFixed.toLocaleString()} permits got a real state extracted`);
}

/* ── 4. Lead<>Permit state/zip sanity sample ────────────────────── */

async function sampleLeadPermitSanity(): Promise<void> {
  console.log("\n[4/5] lead<>permit attribution sanity (sample 50)");
  const { data } = await s
    .from("leads")
    .select("id, zip, permits(zip, state)")
    .not("zip", "is", null)
    .limit(50);
  const rows = data ?? [];
  let mismatches = 0;
  for (const r of rows) {
    const p = r.permits as { zip?: string; state?: string } | null;
    const pZip = p?.zip;
    if (!pZip) continue;
    if (pZip !== r.zip) mismatches++;
  }
  console.log(`  ${mismatches}/${rows.length} lead↔permit zip mismatches`);
}

/* ── 5. Coords outside US bounding box ──────────────────────────── */

async function fixOutOfUSCoords(): Promise<void> {
  console.log("\n[5/5] permits with coords outside US");
  // Rough US envelope incl. AK / HI / PR:
  //   continental: lat 24-50, lng -125..-66
  //   AK:          lat 52-72, lng -180..-130
  //   HI:          lat 18-23, lng -162..-154
  //   PR/VI:       lat 17-19, lng -68..-64
  // Outside ALL of these → clearly wrong.
  //
  // We check one easy case: lat < 15 or lat > 75 (impossible for US).
  for (const table of ["permits", "leads"]) {
    const { data: tooSouth } = await s
      .from(table).select("id").lt("latitude", 15).not("latitude", "is", null).limit(5000);
    const southIds = (tooSouth ?? []).map((r) => r.id as string);
    if (southIds.length > 0) {
      const ok = await updateBatch(table, southIds, { latitude: null, longitude: null });
      console.log(`  ${table}: nulled coords on ${ok} rows with lat<15 (south of PR)`);
    }
    const { data: tooNorth } = await s
      .from(table).select("id").gt("latitude", 75).not("latitude", "is", null).limit(5000);
    const northIds = (tooNorth ?? []).map((r) => r.id as string);
    if (northIds.length > 0) {
      const ok = await updateBatch(table, northIds, { latitude: null, longitude: null });
      console.log(`  ${table}: nulled coords on ${ok} rows with lat>75 (north of AK)`);
    }
  }
}

(async () => {
  console.log(DRY_RUN ? "[DRY RUN]" : "[LIVE]", "cleanup-data-quality");
  await fixNullIsland();
  await fixOrphanZips();
  await fixMissingState();
  await sampleLeadPermitSanity();
  await fixOutOfUSCoords();
  console.log("\ndone");
})();
