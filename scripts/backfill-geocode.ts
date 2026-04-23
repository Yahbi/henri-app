#!/usr/bin/env npx tsx
/* ── Backfill Geocoding ──────────────────────────────────────────────────────
 * Fetches permits that are already in Supabase but lack coordinates,
 * geocodes them, and updates the records in place.
 *
 * Use this when permits were uploaded without geocoding and you need to
 * add lat/lng retroactively so they appear on the map.
 *
 * Usage:
 *   npx tsx scripts/backfill-geocode.ts
 *   npx tsx scripts/backfill-geocode.ts --retry-failed
 *
 * Requires:
 *   - .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * ────────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import {
  geocodeBatch,
  geocodeRetryFailed,
  type GeocodableRecord,
} from "../src/lib/ingest/geocode";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RETRY_FAILED = process.argv.includes("--retry-failed");
const BATCH_SIZE = 100;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  console.error("Fill in your Supabase credentials and try again.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function main() {
  console.log("=".repeat(60));
  console.log("  Henri — Backfill Geocoding");
  console.log("=".repeat(60));

  /* ── 1. Fetch permits without coordinates ───────────────────────────── */
  console.log("\n[1/3] Fetching permits without coordinates...");

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/permits?latitude=is.null&select=id,address,city,state,zip&limit=5000`,
    { headers },
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`Failed to fetch permits: ${response.status} ${body}`);
    process.exit(1);
  }

  const permits: Array<{
    id: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  }> = await response.json();

  console.log(`  Found ${permits.length} permits without coordinates`);

  if (permits.length === 0) {
    console.log("  Nothing to geocode. All permits already have coordinates.");
    return;
  }

  const geocodable = permits.filter((p) => p.address && p.address.length > 3 && p.city);
  console.log(`  ${geocodable.length} have valid addresses for geocoding`);

  /* ── 2. Geocode ─────────────────────────────────────────────────────── */
  console.log("\n[2/3] Geocoding via Census Bureau...");

  const records: GeocodableRecord[] = geocodable.map((p) => ({
    id: p.id,
    address: p.address,
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.zip,
  }));

  let coords = await geocodeBatch(records, (completed, total) => {
    console.log(`  Batch progress: ${completed}/${total}`);
  });

  console.log(`  Batch geocoded: ${coords.size}/${records.length}`);

  if (RETRY_FAILED) {
    const beforeRetry = coords.size;
    console.log(`  Retrying ${records.length - coords.size} failures individually...`);
    coords = await geocodeRetryFailed(records, coords, (completed, total) => {
      if (completed % 100 === 0) console.log(`  Retry: ${completed}/${total}`);
    });
    console.log(`  Recovered ${coords.size - beforeRetry} more`);
  }

  console.log(`  Total geocoded: ${coords.size}/${records.length} (${((coords.size / records.length) * 100).toFixed(1)}%)`);

  if (coords.size === 0) {
    console.log("  No addresses could be geocoded.");
    return;
  }

  /* ── 3. Update Supabase ─────────────────────────────────────────────── */
  console.log(`\n[3/3] Updating ${coords.size} permits in Supabase...`);

  let updated = 0;
  let errors = 0;
  const entries = Array.from(coords.entries());

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    // Supabase REST API doesn't support bulk UPDATE by different IDs,
    // so we update one at a time (still fast via HTTP pipelining)
    await Promise.all(
      batch.map(async ([id, { latitude, longitude }]) => {
        try {
          const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/permits?id=eq.${id}`,
            {
              method: "PATCH",
              headers,
              body: JSON.stringify({ latitude, longitude }),
            },
          );
          if (resp.ok) {
            updated++;
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      }),
    );

    const progress = Math.min(i + BATCH_SIZE, entries.length);
    console.log(`  Updated ${progress}/${entries.length}`);
  }

  console.log(`\n  Backfill complete:`);
  console.log(`    Updated: ${updated}`);
  console.log(`    Errors: ${errors}`);
  console.log(`    Remaining without coords: ${permits.length - updated}`);

  console.log("\n" + "=".repeat(60));
  console.log("  Done — run 'npm run score' to create leads from updated permits");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
