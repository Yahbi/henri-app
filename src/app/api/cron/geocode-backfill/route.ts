import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// 5 min budget; Nominatim rate-limit means we can only do ~250 rows per run
// at 1 req/sec (+ margin). Schedule this every 15 min to clear 24k rows/day.
export const maxDuration = 300;

const NOM_UA =
  "Henri Lead-Gen Platform (free-tier, contact: y.abismuth@gmail.com)";
const NOM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

/**
 * Free geocoding via OpenStreetMap's Nominatim service.
 *
 * Policy: 1 req/sec from a single IP, unlimited volume, User-Agent REQUIRED
 * with valid contact email. See: https://operations.osmfoundation.org/policies/nominatim/
 *
 * This backfills permits.latitude/longitude for the ~221k permits that were
 * ingested without coordinates from their upstream source. Each successful
 * hit is cascaded to any matching lead rows so the dashboard map picks them
 * up immediately.
 */
async function geocodeOne(
  address: string,
  zip: string | null,
  state: string | null,
): Promise<{ lat: number; lng: number } | null> {
  // Build the query. Nominatim handles US addresses best when we append
  // zip + state + country rather than relying on free-form parsing.
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
    // Guard against obvious nonsense (Nominatim occasionally returns the
    // country centroid when the address is unparseable).
    if (lat < 17 || lat > 72 || lng < -180 || lng > -65) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  // 250 rows / 1.1s per request ≈ 275s, under our 300s budget. Leaves ~25s
  // for Supabase round-trips and cleanup.
  const BATCH = 250;
  const t0 = Date.now();

  const { data: rows, error } = await supabase
    .from("permits")
    .select("id, address, zip, state")
    .is("latitude", null)
    .not("address", "is", null)
    .limit(BATCH);

  if (error) {
    logger.error("Geocode backfill scan error", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let filled = 0;
  let missed = 0;
  let cascadedLeads = 0;

  for (const r of rows ?? []) {
    const hit = await geocodeOne(
      r.address as string,
      r.zip as string | null,
      r.state as string | null,
    );
    if (hit) {
      const { error: upErr } = await supabase
        .from("permits")
        .update({ latitude: hit.lat, longitude: hit.lng })
        .eq("id", r.id);
      if (!upErr) {
        filled++;
        // Cascade to any existing leads for this permit so the dashboard
        // map picks them up on the next fetch.
        const { data: updated, error: leadErr } = await supabase
          .from("leads")
          .update({ latitude: hit.lat, longitude: hit.lng })
          .eq("permit_id", r.id)
          .select("id");
        if (!leadErr && updated) cascadedLeads += updated.length;
      }
    } else {
      missed++;
    }

    // Nominatim policy: ≥1 second between requests from one IP.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Safety valve: bail early if we're approaching the function timeout.
    if (Date.now() - t0 > 280_000) break;
  }

  return NextResponse.json({
    success: true,
    summary: {
      scanned: rows?.length ?? 0,
      filled,
      missed,
      cascadedLeads,
      elapsedMs: Date.now() - t0,
    },
  });
}
