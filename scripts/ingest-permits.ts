#!/usr/bin/env npx tsx
/* ── Permit Ingestion Pipeline ─────────────────────────────────────────────
 * Reads raw permit data from a SQLite database (permits.db), normalizes it
 * per-vendor, deduplicates, geocodes addresses, and uploads to Supabase's
 * `permits` table.
 *
 * The scoring cron (/api/cron/score) then picks up unscored permits
 * and creates scored leads with contractor assignments.
 *
 * Usage:
 *   npx tsx scripts/ingest-permits.ts [path-to-permits.db]
 *
 * Flags:
 *   --skip-geocode    Skip geocoding step (upload without coordinates)
 *   --retry-failed    Also retry individually-geocoding batch failures
 *
 * Requires:
 *   - SUPABASE_SERVICE_ROLE_KEY env var (loaded from .env.local)
 *   - NEXT_PUBLIC_SUPABASE_URL env var (loaded from .env.local)
 *   - better-sqlite3 (devDependency)
 * ────────────────────────────────────────────────────────────────────────── */

/* Load .env.local so scripts work outside Next.js runtime */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import Database from "better-sqlite3";
import {
  normalizeRow,
  deduplicatePermits,
  type RawPermitRow,
  type NormalizedPermit,
} from "../src/lib/ingest/normalize";
import {
  geocodeBatch,
  geocodeRetryFailed,
  type GeocodableRecord,
} from "../src/lib/ingest/geocode";

/* ── Config ────────────────────────────────────────────────────────────── */

const NON_FLAG_ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DB_PATH = NON_FLAG_ARGS[0] || "C:\\Users\\yabis\\Desktop\\permits.db";
const BATCH_SIZE = 100;
const SKIP_GEOCODE = process.argv.includes("--skip-geocode");
const RETRY_FAILED = process.argv.includes("--retry-failed");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ── Step 1: Read from SQLite ─────────────────────────────────────────── */

function readSqlite(dbPath: string): RawPermitRow[] {
  console.log(`\n[1/6] Reading from ${dbPath}...`);

  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM permits").all() as RawPermitRow[];
    db.close();
    console.log(`  Found ${rows.length} raw rows`);
    return rows;
  } catch (error) {
    console.error("Failed to read SQLite database:", error);
    process.exit(1);
  }
}

/* ── Step 2: Deduplicate ──────────────────────────────────────────────── */

function deduplicate(rows: RawPermitRow[]): RawPermitRow[] {
  console.log(`\n[2/6] Deduplicating...`);
  const unique = deduplicatePermits(rows);
  const removed = rows.length - unique.length;
  console.log(`  Removed ${removed} duplicates (${((removed / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  ${unique.length} unique permits remaining`);
  return unique;
}

/* ── Step 3: Normalize ────────────────────────────────────────────────── */

function normalize(rows: RawPermitRow[]): NormalizedPermit[] {
  console.log(`\n[3/6] Normalizing per vendor...`);

  const results: NormalizedPermit[] = [];
  let garbage = 0;

  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (normalized) {
      results.push(normalized);
    } else {
      garbage++;
    }
  }

  console.log(`  Normalized: ${results.length}`);
  console.log(`  Filtered (garbage/admin): ${garbage}`);

  // Stats
  const byVendor = new Map<string, number>();
  const byTrade = new Map<string, number>();
  const withOwner = results.filter((r) => r.ownerName).length;
  const withZip = results.filter((r) => r.zip).length;
  const withAddress = results.filter((r) => r.address).length;

  for (const r of results) {
    byVendor.set(r.vendor, (byVendor.get(r.vendor) ?? 0) + 1);
    byTrade.set(r.trade, (byTrade.get(r.trade) ?? 0) + 1);
  }

  console.log(`\n  By vendor:`);
  for (const [vendor, count] of byVendor) {
    console.log(`    ${vendor}: ${count}`);
  }

  console.log(`\n  By trade (top 10):`);
  const sortedTrades = [...byTrade.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [trade, count] of sortedTrades) {
    console.log(`    ${trade}: ${count}`);
  }

  console.log(`\n  Data quality:`);
  console.log(`    With address: ${withAddress} (${((withAddress / results.length) * 100).toFixed(1)}%)`);
  console.log(`    With ZIP: ${withZip} (${((withZip / results.length) * 100).toFixed(1)}%)`);
  console.log(`    With owner name: ${withOwner} (${((withOwner / results.length) * 100).toFixed(1)}%)`);

  return results;
}

/* ── Step 4: Geocode ─────────────────────────────────────────────────── */

async function geocode(
  permits: NormalizedPermit[],
): Promise<Map<string, { latitude: number; longitude: number }>> {
  if (SKIP_GEOCODE) {
    console.log(`\n[4/6] Geocoding SKIPPED (--skip-geocode flag)`);
    return new Map();
  }

  console.log(`\n[4/6] Geocoding ${permits.length} addresses via Census Bureau...`);

  // Build geocodable records
  const records: GeocodableRecord[] = permits
    .filter((p) => p.address && p.address.length > 3)
    .map((p) => ({
      id: p.permitNumber,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
    }));

  console.log(`  ${records.length} addresses eligible for geocoding`);

  // Batch geocode
  const coords = await geocodeBatch(records, (completed, total) => {
    console.log(`  Batch progress: ${completed}/${total}`);
  });

  console.log(`  Batch geocoded: ${coords.size}/${records.length} (${((coords.size / records.length) * 100).toFixed(1)}%)`);

  // Retry failures individually if requested
  if (RETRY_FAILED) {
    const beforeRetry = coords.size;
    console.log(`  Retrying ${records.length - coords.size} failures individually...`);

    await geocodeRetryFailed(records, coords, (completed, total) => {
      if (completed % 100 === 0) {
        console.log(`  Retry progress: ${completed}/${total}`);
      }
    });

    const recovered = coords.size - beforeRetry;
    console.log(`  Recovered ${recovered} additional coordinates`);
  }

  console.log(`\n  Geocoding summary:`);
  console.log(`    Total geocoded: ${coords.size}/${records.length} (${((coords.size / records.length) * 100).toFixed(1)}%)`);
  console.log(`    Missing: ${records.length - coords.size}`);

  return coords;
}

/* ── Step 5: Build Supabase payloads ──────────────────────────────────── */

interface SupabasePermitInsert {
  source_city: string;
  source_id: string;
  permit_number: string;
  permit_type: string;
  status: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  applicant_name: string | null;
  contractor_name: string | null;
  estimated_value: null;
  applied_date: string | null;
  source_type: string;
  raw_json: Record<string, unknown>;
}

function buildPayloads(
  permits: NormalizedPermit[],
  coords: Map<string, { latitude: number; longitude: number }>,
): SupabasePermitInsert[] {
  console.log(`\n[5/6] Building Supabase payloads...`);

  let withCoords = 0;

  const payloads = permits.map((p) => {
    const geo = coords.get(p.permitNumber);
    if (geo) withCoords++;

    return {
      source_city: p.sourceCity,
      source_id: p.sourceId,
      permit_number: p.permitNumber,
      permit_type: p.permitTypeEnum,
      status: p.statusEnum,
      description: p.description,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      applicant_name: p.ownerName,
      contractor_name: p.contractorName,
      estimated_value: null,
      applied_date: p.scrapedDate,
      source_type: p.vendor,
      raw_json: {
        ...p.rawJson,
        normalized_trade: p.trade,
        normalized_permit_type: p.permitTypeEnum,
        permit_type_raw: p.permitTypeRaw,
        owner_first: p.ownerFirst,
        owner_last: p.ownerLast,
      },
    };
  });

  console.log(`  ${payloads.length} payloads built`);
  console.log(`  ${withCoords} with coordinates (${((withCoords / payloads.length) * 100).toFixed(1)}%)`);
  console.log(`  ${payloads.length - withCoords} without coordinates`);

  return payloads;
}

/* ── Step 6: Upload to Supabase ───────────────────────────────────────── */

async function uploadToSupabase(payloads: SupabasePermitInsert[]): Promise<void> {
  console.log(`\n[6/6] Uploading ${payloads.length} permits to Supabase...`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("\n  [DRY RUN] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.");
    console.log("  Set these env vars to upload for real.");
    console.log(`  Would upload ${payloads.length} permits in ${Math.ceil(payloads.length / BATCH_SIZE)} batches.`);

    // Print a sample payload
    console.log("\n  Sample payload (first record):");
    console.log(JSON.stringify(payloads[0], null, 2));

    // Print coordinate coverage
    const withCoords = payloads.filter((p) => p.latitude !== null).length;
    console.log(`\n  Coordinate coverage: ${withCoords}/${payloads.length}`);
    return;
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };

  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(payloads.length / BATCH_SIZE);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/permits`, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });

      if (response.ok) {
        uploaded += batch.length;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} permits uploaded`);
      } else if (response.status === 409) {
        // Conflict = duplicates already exist
        skipped += batch.length;
        console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} permits skipped (already exist)`);
      } else {
        const body = await response.text();
        errors += batch.length;
        console.error(`  Batch ${batchNum}/${totalBatches} FAILED (${response.status}): ${body}`);

        // Try individual inserts for failed batch
        if (batch.length > 1) {
          console.log(`  Retrying batch ${batchNum} individually...`);
          for (const single of batch) {
            try {
              const singleResp = await fetch(`${SUPABASE_URL}/rest/v1/permits`, {
                method: "POST",
                headers,
                body: JSON.stringify(single),
              });
              if (singleResp.ok) {
                uploaded++;
                errors--;
              } else if (singleResp.status === 409) {
                skipped++;
                errors--;
              }
            } catch {
              // Individual insert failed, leave in error count
            }
          }
        }
      }
    } catch (err) {
      errors += batch.length;
      console.error(`  Batch ${batchNum}/${totalBatches} network error:`, err);
    }
  }

  console.log(`\n  Upload complete:`);
  console.log(`    Uploaded: ${uploaded}`);
  console.log(`    Skipped (duplicate): ${skipped}`);
  console.log(`    Errors: ${errors}`);
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  console.log("=".repeat(60));
  console.log("  Henri Permit Ingestion Pipeline");
  console.log("=".repeat(60));

  const raw = readSqlite(DB_PATH);
  const unique = deduplicate(raw);
  const normalized = normalize(unique);
  const coords = await geocode(normalized);
  const payloads = buildPayloads(normalized, coords);
  await uploadToSupabase(payloads);

  console.log("\n" + "=".repeat(60));
  console.log("  Pipeline complete");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
