/**
 * Targeted geocoding for the 210,302 permits that have clean
 * address+state+zip. Bypasses /api/cron/geocode-backfill which doesn't
 * filter on data quality and ends up wasting Nominatim calls on degenerate
 * permits (e.g. address=null, city="Howardcounty"). 0% hit rate path.
 *
 * Strategy:
 *   1. Pull 250 permits with `latitude IS NULL AND state IS NOT NULL AND
 *      zip IS NOT NULL AND address IS NOT NULL` (the "clean" pool).
 *   2. For each: hit OpenStreetMap Nominatim at 1.1 req/sec (their policy).
 *   3. Persist lat/lng on the permit when matched.
 *   4. Repeat until backlog drained or COUNT iterations done.
 *
 * Usage:
 *   npx tsx scripts/_geocode-clean-permits.ts
 *   COUNT=10 npx tsx scripts/_geocode-clean-permits.ts
 *   BATCH=100 npx tsx scripts/_geocode-clean-permits.ts
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

const COUNT = Number(process.env.COUNT ?? 30);
const BATCH = Number(process.env.BATCH ?? 100);
const REQ_INTERVAL_MS = 1100; // Nominatim policy: 1 req/sec

const NOM_UA =
  "Henri Lead-Gen Platform (free-tier, contact: y.abismuth@gmail.com)";
const NOM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

async function geocodeOne(
  address: string,
  zip: string | null,
  state: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const parts = [address];
  if (zip) parts.push(zip);
  if (state) parts.push(state);
  parts.push("USA");
  const url = `${NOM_ENDPOINT}?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(parts.join(", "))}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": NOM_UA,
        Accept: "application/json",
        "Accept-Language": "en-US,en",
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!rows?.length) return null;
    const lat = parseFloat(rows[0].lat);
    const lng = parseFloat(rows[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < 17 || lat > 72 || lng < -180 || lng > -65) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function runOne(iter: number): Promise<{ scanned: number; geocoded: number }> {
  const t0 = Date.now();
  const { data: rows, error } = await s
    .from("permits")
    .select("id, address, zip, state")
    .is("latitude", null)
    .not("address", "is", null)
    .not("state", "is", null)
    .not("zip", "is", null)
    .limit(BATCH);

  if (error) {
    console.warn(`  [${iter}] fetch failed: ${error.message}`);
    return { scanned: 0, geocoded: 0 };
  }
  if (!rows || rows.length === 0) {
    console.log(`  [${iter}] no clean ungeocoded permits left`);
    return { scanned: 0, geocoded: 0 };
  }

  let geocoded = 0;
  for (const r of rows as Array<{ id: string; address: string; zip: string | null; state: string | null }>) {
    const coords = await geocodeOne(r.address, r.zip, r.state);
    if (coords) {
      const { error: upErr } = await s
        .from("permits")
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq("id", r.id);
      if (!upErr) geocoded++;
    }
    // Polite to Nominatim
    await new Promise((res) => setTimeout(res, REQ_INTERVAL_MS));
  }

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`  [${iter}/${COUNT}] scanned=${rows.length} geocoded=${geocoded} (${((geocoded / rows.length) * 100).toFixed(0)}%) elapsed=${sec}s`);
  return { scanned: rows.length, geocoded };
}

async function main() {
  console.log(`── geocode-clean-permits (Nominatim) ───────────────`);
  console.log(`  count=${COUNT}, batch=${BATCH}, interval=${REQ_INTERVAL_MS}ms`);
  let totalScanned = 0;
  let totalGeocoded = 0;
  let zeroRuns = 0;
  for (let i = 1; i <= COUNT; i++) {
    const r = await runOne(i);
    totalScanned += r.scanned;
    totalGeocoded += r.geocoded;
    if (r.scanned === 0) {
      zeroRuns++;
      if (zeroRuns >= 2) {
        console.log(`  2 consecutive empty runs — backlog drained. stopping.`);
        break;
      }
    } else {
      zeroRuns = 0;
    }
  }
  const overallRate = totalScanned > 0 ? ((totalGeocoded / totalScanned) * 100).toFixed(1) : "0";
  console.log(`\nTotal: scanned=${totalScanned}, geocoded=${totalGeocoded} (${overallRate}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
