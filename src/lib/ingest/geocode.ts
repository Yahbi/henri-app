/* ── Address Geocoding ────────────────────────────────────────────────────────
 * Uses the US Census Bureau Geocoder (free, no API key required) to convert
 * street addresses into lat/lng coordinates.
 *
 * Two modes:
 *   1. Batch — upload CSV of up to 1,000 addresses at a time (fast)
 *   2. Single — one-off lookups for batch failures (fallback)
 *
 * Census geocoder docs:
 *   https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 * ─────────────────────────────────────────────────────────────────────────── */

import { logger } from "@/lib/logger";

export interface GeocodedAddress {
  id: string;
  latitude: number | null;
  longitude: number | null;
  matchedAddress: string | null;
}

export interface GeocodableRecord {
  id: string;
  address: string | null;
  city: string;
  state: string;
  zip: string | null;
}

/* ── Single-address geocoding ─────────────────────────────────────────────── */

const SINGLE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export async function geocodeSingle(
  address: string,
  city: string,
  state: string,
  zip: string | null,
): Promise<{ latitude: number | null; longitude: number | null }> {
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  const params = new URLSearchParams({
    address: fullAddress,
    benchmark: "Public_AR_Current",
    format: "json",
  });

  try {
    const response = await fetch(`${SINGLE_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return { latitude: null, longitude: null };

    const data = await response.json();
    const matches = data?.result?.addressMatches;

    if (!matches || matches.length === 0) {
      return { latitude: null, longitude: null };
    }

    const coords = matches[0].coordinates;
    return {
      latitude: coords?.y ?? null,
      longitude: coords?.x ?? null,
    };
  } catch {
    return { latitude: null, longitude: null };
  }
}

/* ── Batch geocoding via CSV upload ───────────────────────────────────────── */

const BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_CHUNK_SIZE = 1000; // Census API max per request

/**
 * Build a CSV string for the Census batch geocoder.
 * Format: Unique ID, Street Address, City, State, ZIP
 */
function buildBatchCSV(records: GeocodableRecord[]): string {
  return records
    .map((r) => {
      const street = (r.address ?? "").replace(/"/g, '""');
      const city = r.city.replace(/"/g, '""');
      const state = r.state.replace(/"/g, '""');
      const zip = (r.zip ?? "").replace(/"/g, '""');
      return `"${r.id}","${street}","${city}","${state}","${zip}"`;
    })
    .join("\n");
}

/**
 * Parse the Census batch geocoder response CSV.
 * Response format: "ID","InputAddress","Match","MatchType","MatchedAddress","Lon,Lat","TigerID","Side"
 */
function parseBatchResponse(csv: string): GeocodedAddress[] {
  const results: GeocodedAddress[] = [];

  for (const line of csv.split("\n")) {
    if (!line.trim()) continue;

    // Parse CSV — handle quoted fields with commas inside
    const fields = parseCSVLine(line);
    if (fields.length < 6) continue;

    const id = fields[0].replace(/"/g, "");
    const matchStatus = fields[2].replace(/"/g, "").trim();
    const matchedAddress = fields[4]?.replace(/"/g, "") || null;

    if (matchStatus !== "Match") {
      results.push({ id, latitude: null, longitude: null, matchedAddress: null });
      continue;
    }

    // Coordinates field: "lon,lat" (note: longitude first)
    const coordStr = fields[5].replace(/"/g, "");
    const [lonStr, latStr] = coordStr.split(",");
    const longitude = parseFloat(lonStr);
    const latitude = parseFloat(latStr);

    results.push({
      id,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      matchedAddress,
    });
  }

  return results;
}

/** Simple CSV line parser that handles quoted fields with internal commas */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Geocode a batch of records using the Census Bureau batch endpoint.
 * Handles chunking (max 1,000 per request) and retries.
 */
export async function geocodeBatch(
  records: GeocodableRecord[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, { latitude: number; longitude: number }>> {
  const results = new Map<string, { latitude: number; longitude: number }>();

  // Filter to only records with valid addresses
  const geocodable = records.filter(
    (r) => r.address && r.address.length > 3 && r.city,
  );

  if (geocodable.length === 0) return results;

  const totalChunks = Math.ceil(geocodable.length / BATCH_CHUNK_SIZE);

  for (let i = 0; i < geocodable.length; i += BATCH_CHUNK_SIZE) {
    const chunk = geocodable.slice(i, i + BATCH_CHUNK_SIZE);
    const chunkNum = Math.floor(i / BATCH_CHUNK_SIZE) + 1;

    try {
      const csv = buildBatchCSV(chunk);
      const blob = new Blob([csv], { type: "text/csv" });

      const formData = new FormData();
      formData.append("addressFile", blob, "addresses.csv");
      formData.append("benchmark", "Public_AR_Current");

      const response = await fetch(BATCH_URL, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120_000), // 2 min timeout per chunk
      });

      if (!response.ok) {
        logger.error("Batch geocode failed", {
          chunk: chunkNum,
          totalChunks,
          status: response.status,
        });
        continue;
      }

      const responseText = await response.text();
      const parsed = parseBatchResponse(responseText);

      for (const result of parsed) {
        if (result.latitude !== null && result.longitude !== null) {
          results.set(result.id, {
            latitude: result.latitude,
            longitude: result.longitude,
          });
        }
      }

      onProgress?.(Math.min(i + BATCH_CHUNK_SIZE, geocodable.length), geocodable.length);

      // Rate limit: pause 1 second between chunks to be respectful
      if (chunkNum < totalChunks) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      logger.error("Batch geocode error", {
        chunk: chunkNum,
        totalChunks,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Retry geocoding for records that failed batch — uses individual lookups.
 * Much slower but sometimes catches addresses the batch endpoint misses.
 */
export async function geocodeRetryFailed(
  records: GeocodableRecord[],
  alreadyGeocoded: Map<string, { latitude: number; longitude: number }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, { latitude: number; longitude: number }>> {
  const failed = records.filter(
    (r) => r.address && r.address.length > 3 && !alreadyGeocoded.has(r.id),
  );

  if (failed.length === 0) return alreadyGeocoded;

  let completed = 0;

  for (const record of failed) {
    try {
      const result = await geocodeSingle(
        record.address!,
        record.city,
        record.state,
        record.zip,
      );

      if (result.latitude !== null && result.longitude !== null) {
        alreadyGeocoded.set(record.id, {
          latitude: result.latitude,
          longitude: result.longitude,
        });
      }
    } catch {
      // Skip this one
    }

    completed++;
    if (completed % 50 === 0) {
      onProgress?.(completed, failed.length);
    }

    // Rate limit: 200ms between individual requests
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  onProgress?.(failed.length, failed.length);
  return alreadyGeocoded;
}
