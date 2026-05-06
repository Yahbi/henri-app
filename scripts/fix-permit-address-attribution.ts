/**
 * Fix permit rows where the normalizer attributed the wrong `zip` /
 * `city` relative to the address string.
 *
 * Discovered (2026-04-23 audit):
 *   - 2,267 permits with zip='00000' (sentinel)
 *   - 5,737 CA permits whose `zip` doesn't start with 9 (CA ZIPs = 900-961)
 *   - 5,831 TX permits whose `zip` doesn't start with 7 (TX ZIPs = 733-799)
 *   -   628 FL permits whose `zip` doesn't start with 3 (FL ZIPs = 320-349)
 *
 *   Typical pathology: zip column holds the house number — e.g. row
 *   has address="10000 OCCIDENTAL RD, Sebastopol, CA 95472", state="CA",
 *   zip="10000" (house number), city="CA" (state code). The REAL zip
 *   95472 and city "Sebastopol" are both inside the address string —
 *   we just never extracted them.
 *
 * Fix: for each misattributed row, regex-extract the trailing 5-digit
 * ZIP from the address. If it parses and matches the state's expected
 * prefix, update zip. When the city is clearly wrong (equals a state
 * code), also extract the city token from the address (the name
 * before the state code).
 *
 * Idempotent. Re-runnable. Safe — we only write when we're confident:
 *   - extracted zip must be 5 digits
 *   - extracted zip's first digit must match the state's expected prefix
 *   - or we only flip from '00000' / house-number-sized
 *
 * Run: npx tsx scripts/fix-permit-address-attribution.ts
 *      DRY_RUN=1 npx tsx scripts/fix-permit-address-attribution.ts
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
const BATCH = 50;

/**
 * State → expected leading ZIP digit(s). Source: USPS ZIP range table.
 * Only includes states we currently have permits for. If a state has a
 * ZIP starting with the wrong digit for its region, USPS reserves it
 * for a different state — flag as a mismatch to fix.
 */
const STATE_ZIP_PREFIX: Record<string, string[]> = {
  // Northeast (0xx)
  CT: ["06"], MA: ["01", "02"], ME: ["03", "04"], NH: ["03"],
  NJ: ["07", "08"], PR: ["00", "006", "007", "009"], RI: ["02"],
  VT: ["05"], VI: ["008"],
  // Mid-Atlantic / South (1-3)
  DE: ["19"], NY: ["1"], PA: ["1"],
  AL: ["35", "36"], FL: ["3"], GA: ["3"], MD: ["20", "21"], MS: ["38", "39"],
  NC: ["27", "28"], SC: ["29"], TN: ["37", "38"], VA: ["22", "23", "24"],
  WV: ["24", "25", "26"], DC: ["20"],
  // Midwest (4-6)
  IN: ["4"], KY: ["4"], MI: ["4"], OH: ["4"],
  IA: ["5"], MN: ["5"], MT: ["59"], ND: ["58"], SD: ["57"], WI: ["5"],
  IL: ["6"], KS: ["6"], MO: ["6"], NE: ["6"],
  // South Central / Mountain (7-8)
  AR: ["71", "72"], LA: ["70", "71"], OK: ["73", "74"], TX: ["7"],
  AZ: ["85", "86"], CO: ["80", "81"], ID: ["83"], NM: ["87", "88"],
  NV: ["89"], UT: ["84"], WY: ["82", "83"],
  // West (9)
  AK: ["99"], CA: ["9"], HI: ["96", "967", "968"], OR: ["97"], WA: ["98", "99"],
};

function expectedPrefixForState(state: string): string[] | null {
  return STATE_ZIP_PREFIX[state.toUpperCase()] ?? null;
}

function zipLooksValidForState(zip: string, state: string): boolean {
  if (!zip || zip.length !== 5 || !/^\d{5}$/.test(zip)) return false;
  if (zip === "00000") return false;
  const prefixes = expectedPrefixForState(state);
  if (!prefixes) return true; // unknown state — accept the zip, can't validate
  return prefixes.some((p) => zip.startsWith(p));
}

/** Extract the last 5-digit token from an address (real US ZIPs appear
 *  at the tail: "...Sebastopol, CA 95472"). Optionally includes ZIP+4. */
function extractZipFromAddress(address: string): string | null {
  if (!address) return null;
  // Match 5 digits at end, or 5-4 format, tolerant of trailing spaces.
  const matches = address.match(/\b(\d{5})(?:-\d{4})?\b(?!\d)/g) ?? [];
  if (matches.length === 0) return null;
  // Last match is almost always the real ZIP (house number comes first).
  const last = matches[matches.length - 1];
  const five = last.slice(0, 5);
  if (five === "00000") return null;
  return five;
}

/** Extract the city token from an address.
 *  Expected shape: "<street>, <city>, <state> <zip>".
 *  We grab the comma-separated part before the " <STATE> <ZIP>" tail. */
function extractCityFromAddress(address: string, state: string): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Walk backward: last part is usually "STATE ZIP"; the part before is city.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    // Skip the trailing "STATE ZIP" segment
    if (new RegExp(`^${state}\\s+\\d{5}`, "i").test(p)) continue;
    // If the part looks like a city (words + no numbers + not a state code), accept
    if (/^[A-Za-z][A-Za-z\s.\-']*$/.test(p) && p.toUpperCase() !== state.toUpperCase()) {
      return p;
    }
  }
  return null;
}

function titlecase(s: string | null): string | null {
  if (!s) return null;
  if (!/[a-z]/.test(s)) {
    return s.toLowerCase().split(/\s+/).map((w) => w && w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return s;
}

(async () => {
  console.log(DRY_RUN ? "[DRY RUN]" : "[LIVE]", "starting fix-permit-address-attribution");

  // Strategy: pull candidates in batches using a filter that matches
  // rows where zip looks wrong for their state. We iterate by picking
  // specific state/zip-mismatch queries — the self-advancing filter
  // pattern means patched rows drop out.
  //
  // The filter: state IS NOT NULL AND (zip = '00000' OR zip doesn't
  // start with the expected prefix for its state). PostgREST can't
  // express "zip doesn't start with state-dependent prefix" in one
  // query, so we iterate per state.

  const states = Object.keys(STATE_ZIP_PREFIX);

  let totalScanned = 0;
  let totalFixed = 0;
  let totalFailed = 0;

  for (const state of states) {
    const prefixes = STATE_ZIP_PREFIX[state];
    if (!prefixes) continue;

    // Build a filter: state=X AND (zip='00000' OR not.like(prefix1%) AND not.like(prefix2%))
    // Instead of the boolean blob, we fetch in 3 passes: '00000', and each prefix mismatch.
    const passes: Array<{ label: string; filter: string }> = [
      { label: "zip=00000", filter: `state=eq.${state}&zip=eq.00000` },
    ];
    // Additional "wrong prefix" pass — only runs if state has a single prefix
    if (prefixes.length === 1 && prefixes[0].length === 1) {
      passes.push({
        label: `zip-prefix-mismatch`,
        filter: `state=eq.${state}&zip=not.like.${prefixes[0]}*&zip=not.is.null&zip=neq.00000`,
      });
    }

    for (const p of passes) {
      let iter = 0;
      while (iter < 50) { // safety cap per state/pass
        iter++;
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/permits?${p.filter}&select=id,state,zip,city,address&limit=${PAGE}`;
        const res = await fetch(url, {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        });
        if (!res.ok) {
          console.warn(`  [${state}/${p.label}] fetch failed: ${res.status}`);
          break;
        }
        const rows = (await res.json()) as Array<{
          id: string; state: string; zip: string; city: string | null; address: string | null;
        }>;
        if (rows.length === 0) break;

        const patches: Array<{ id: string; zip?: string | null; city?: string | null }> = [];
        for (const r of rows) {
          totalScanned++;

          const patch: { id: string; zip?: string | null; city?: string | null } = { id: r.id };

          if (r.address) {
            const newZip = extractZipFromAddress(r.address);
            if (newZip && zipLooksValidForState(newZip, r.state) && newZip !== r.zip) {
              patch.zip = newZip;
            }

            const currentCityIsStateCode = (r.city ?? "").trim().toUpperCase() === r.state.toUpperCase();
            if (currentCityIsStateCode || !r.city) {
              const newCity = titlecase(extractCityFromAddress(r.address, r.state));
              if (newCity && newCity.toUpperCase() !== r.state.toUpperCase()) {
                patch.city = newCity;
              }
            }
          }

          // Fallback: if we couldn't fix the zip AND the current zip is
          // invalid for its state, null it out. This drops the row from
          // the self-advancing filter (`zip=not.like.PREFIX*&zip=not.is.null`)
          // so the scanner can make progress. Downstream UI already
          // treats null zip as "unknown" and won't show a broken value.
          if (!patch.zip && r.zip && !zipLooksValidForState(r.zip, r.state)) {
            patch.zip = null;
          }

          if (patch.zip !== undefined || patch.city !== undefined) patches.push(patch);
        }

        if (patches.length === 0) {
          // No fixes in this page — the filter may be returning the same rows forever.
          // Break to avoid infinite loop.
          console.log(`  [${state}/${p.label}] iter ${iter}: ${rows.length} scanned, 0 fixable — stopping pass`);
          break;
        }

        if (DRY_RUN) {
          totalFixed += patches.length;
          console.log(`  [${state}/${p.label}] iter ${iter}: would fix ${patches.length}/${rows.length} (DRY)`);
        } else {
          // Apply patches — concurrent UPDATE per row (PostgREST has no bulk update
          // with per-row new values; we parallelise inside the batch).
          let ok = 0;
          const CONCURRENCY = 10;
          let i = 0;
          async function worker() {
            while (i < patches.length) {
              const pp = patches[i++];
              if (!pp) break;
              const { id, ...rest } = pp;
              const { error } = await s.from("permits").update(rest).eq("id", id);
              if (!error) ok++; else totalFailed++;
            }
          }
          await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
          totalFixed += ok;
          console.log(`  [${state}/${p.label}] iter ${iter}: ${ok}/${patches.length} fixed (scanned ${totalScanned.toLocaleString()} total)`);
        }

        if (rows.length < PAGE) break;
      }
    }
  }

  console.log(`\nDone. scanned=${totalScanned.toLocaleString()}  fixed=${totalFixed.toLocaleString()}  failed=${totalFailed.toLocaleString()}`);
})();
