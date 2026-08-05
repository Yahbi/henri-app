/**
 * GET /api/cron/census-geocode
 *
 * Free, no-auth, no-rate-limit Census Geocoder Batch API.
 *
 * Sends up to 1000 unjoined `permits` (latitude IS NULL) to the
 * Census Bureau's free batch geocoder
 * (https://geocoding.geo.census.gov/geocoder/locations/addressbatch),
 * parses the returned CSV, and writes the matched lat/lng back to
 * `permits.latitude / longitude` so the dashboard map picks them up.
 *
 * This complements the existing `/api/cron/geocode-backfill` which
 * uses Nominatim at 1 req/sec; the Census endpoint takes 10k addresses
 * per HTTP request and runs much faster — ideal for the bulk backfill
 * of the ~50% of permits without coordinates.
 *
 * Format: per Census docs, the batch endpoint accepts a CSV with
 * columns (id, street, city, state, zip) and returns a CSV with
 * (id, original_address, match_status, match_type, matched_address,
 *  coordinates, tigerline_id, side, state_fips, county_fips, tract,
 *  block). `coordinates` is "<lng>,<lat>".
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 300;

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_SIZE = 1000; // census accepts up to 10k; stay smaller for safety + memory
const MAX_PER_RUN = 5000; // 5 batches per cron tick

interface PermitRow {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface GeocodeMatch {
  id: string;
  lat: number;
  lng: number;
  /**
   * ZIP parsed out of the Census matched-address column.
   *
   * This is the whole reason the cron matters. `leads` are only created for
   * a permit whose ZIP falls inside a claimed territory
   * (api/cron/score/route.ts:1034 `if (!zip) continue;`), so a permit with a
   * NULL zip can never become a lead for ANY contractor, no matter how it
   * scores. Measured 2026-08-05: 1,484,130 of 2,323,156 permits (63.9%) have
   * no ZIP, and 957,520 of those have a geocodable street address.
   *
   * Census returns the ZIP for free — it is the tail of the matched-address
   * field in the same CSV row we already parse for coordinates — and the old
   * parser read only columns 0, 2 and 5, so it fetched the ZIP and discarded
   * it. Nothing else in the codebase writes permits.zip after ingest, which
   * made that discard permanent.
   */
  zip: string | null;
}

/** CSV cell escape — Census expects unquoted simple strings. */
function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const t = String(s).trim();
  // Strip commas + quotes from the input to avoid breaking the CSV
  // shape (Census batch is unquoted-CSV by spec).
  return t.replace(/[,"]/g, " ");
}

/** Parse the Census response CSV. Format is unquoted comma-delimited
 *  with `coordinates` field shaped as "<lng>,<lat>" — note the embedded
 *  comma — so we can't use a naïve split. The Census docs guarantee a
 *  fixed column count when the row is "Match", which is what we filter
 *  for. */
function parseCensusBatch(text: string): GeocodeMatch[] {
  const out: GeocodeMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // Split on quoted CSV. Census uses double-quoted strings around any
    // value that contains commas (notably matched_address + coordinates).
    const cells = parseCsvLine(line);
    if (cells.length < 6) continue;
    const id = cells[0]?.trim();
    const matchStatus = cells[2]?.trim();
    if (!id || matchStatus !== "Match") continue;
    const coords = cells[5]?.trim(); // "lng,lat"
    if (!coords) continue;
    const [lngStr, latStr] = coords.split(",");
    const lng = Number(lngStr);
    const lat = Number(latStr);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    // cells[4] is the matched address, which Census normalises to
    // "123 MAIN ST, ANYTOWN, TX, 78701" — the ZIP is the trailing token.
    // Anchored to end-of-string so a house number or a street name that
    // happens to contain five digits cannot be mistaken for a ZIP. ZIP+4 is
    // accepted and truncated to the 5-digit form the rest of the schema uses
    // (territories, zip_demand_scores and the score cron all key on 5).
    const zipMatch = /(\d{5})(?:-\d{4})?\s*$/.exec(cells[4]?.trim() ?? "");
    out.push({ id, lat, lng, zip: zipMatch ? zipMatch[1] : null });
  }
  return out;
}

/** Minimal RFC-4180-ish CSV row parser (unquoted vs quoted segments). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Build the multipart body the Census batch endpoint expects. */
function buildMultipart(csvText: string): { body: Buffer; contentType: string } {
  const boundary = `----HenriBatchBoundary${Date.now()}`;
  const parts: (string | Buffer)[] = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="addressFile"; filename="batch.csv"',
    "Content-Type: text/csv",
    "",
    csvText,
    `--${boundary}`,
    'Content-Disposition: form-data; name="benchmark"',
    "",
    "Public_AR_Current",
    `--${boundary}--`,
    "",
  ];
  const bodyStr = parts.join("\r\n");
  return {
    body: Buffer.from(bodyStr, "utf8"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function geocodeBatch(rows: PermitRow[]): Promise<GeocodeMatch[]> {
  // Build the input CSV — id, street, city, state, zip
  const csvLines = rows.map((r) =>
    [
      csvEscape(r.id),
      csvEscape(r.address),
      csvEscape(r.city),
      csvEscape(r.state),
      csvEscape(r.zip),
    ].join(","),
  );
  const csvText = csvLines.join("\n");
  const { body, contentType } = buildMultipart(csvText);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": contentType, "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
    body: body as unknown as BodyInit,
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) {
    logger.warn("census-geocode.fetch_failed", { status: res.status });
    return [];
  }
  const text = await res.text();
  return parseCensusBatch(text);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  let totalGeocoded = 0;
  // Tracked separately from totalGeocoded because it is the number that
  // actually predicts lead growth: a coordinate helps the map, but only a
  // ZIP can make a permit match a claimed territory.
  let totalZipped = 0;
  let totalFetched = 0;
  let batches = 0;

  try {
    while (totalFetched < MAX_PER_RUN) {
      const remaining = MAX_PER_RUN - totalFetched;
      const fetchSize = Math.min(BATCH_SIZE, remaining);

      // Candidates are permits missing EITHER coordinates OR a ZIP.
      //
      // This used to be `.is("latitude", null)` alone, which quietly excluded
      // the 282,649 permits that already have coordinates and are missing
      // only the ZIP — the exact rows that are one field away from being
      // lead-eligible. Having a latitude was treated as "this row is done",
      // but latitude is not what gates lead creation; ZIP is.
      //
      // `[object Object]` is excluded explicitly: 125,504 permits carry that
      // literal string as their address because a Socrata location OBJECT was
      // stringified at ingest. Sending it to Census wastes a slot in every
      // batch and can never match. Those rows need their address rebuilt from
      // raw_json first — a separate repair.
      const { data: pending, error: fetchErr } = await supabase
        .from("permits")
        .select("id, address, city, state, zip")
        .or("latitude.is.null,zip.is.null")
        .not("address", "is", null)
        .neq("address", "")
        .neq("address", "[object Object]")
        .limit(fetchSize);

      if (fetchErr) {
        logger.error("census-geocode.fetch_pending_failed", { error: fetchErr.message });
        break;
      }
      if (!pending || pending.length === 0) break;

      const matches = await geocodeBatch(pending as PermitRow[]);
      batches += 1;
      totalFetched += pending.length;

      // Bulk update via individual updates (Supabase doesn't support
      // multi-row UPDATE in a single round-trip via the JS client). Use
      // a transaction-y loop with Promise.allSettled so a few failures
      // don't break the batch.
      const updates = matches.map(async (m) => {
        // Only ever ADD a zip, never overwrite one. A permit that arrived
        // from its source with a ZIP has better provenance than a Census
        // fuzzy match, and territory assignment keys off this column.
        const patch: { latitude: number; longitude: number; zip?: string } =
          { latitude: m.lat, longitude: m.lng };
        if (m.zip) patch.zip = m.zip;

        const q = supabase.from("permits").update(patch).eq("id", m.id);
        const { error } = m.zip
          ? await q.or("zip.is.null,zip.eq.")
          : await q;
        if (error) logger.warn("census-geocode.update_failed", { id: m.id, error: error.message });
      });
      await Promise.allSettled(updates);
      totalGeocoded += matches.length;
      totalZipped += matches.filter((m) => m.zip).length;

      logger.info("census-geocode.batch_done", {
        batch: batches,
        sent: pending.length,
        matched: matches.length,
      });

      if (pending.length < fetchSize) break; // ran out of candidates
    }

    logger.info("census-geocode.done", {
      duration_ms: Date.now() - startedAt,
      batches,
      fetched: totalFetched,
      geocoded: totalGeocoded,
      zipped: totalZipped,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      batches,
      fetched: totalFetched,
      geocoded: totalGeocoded,
      zipped: totalZipped,
    };
    await logCronRun("census-geocode", startedAt, {
      pulled: totalFetched, inserted: totalGeocoded,
      summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("census-geocode.error", { error: String(err) });
    await logCronRun("census-geocode", startedAt, {
      pulled: totalFetched, inserted: totalGeocoded,
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "census-geocode failed", detail: String(err) },
      { status: 500 },
    );
  }
}
