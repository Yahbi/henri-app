/**
 * ArcGIS Feature Service scraper
 *
 * ArcGIS REST endpoints follow the pattern:
 *   {base}/query?where=1=1&outFields=*&f=json&resultOffset={n}&resultRecordCount=1000
 *
 * Response shape:
 *   { features: [{ attributes: { PERMIT_NUM: "...", ... }, geometry: { x: lng, y: lat } }] }
 *
 * Note: ArcGIS geometry uses x = longitude, y = latitude (opposite of typical lat/lng order).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  classifyPermitType,
  normalizeStatus,
  parseDate,
  extractZip,
  parseCoord,
  parseMoney,
} from "./normalizer";
import type { ScrapeResult } from "@/types/permits";

interface ArcGISSource {
  source_key: string;
  city: string;
  state: string;
  endpoint: string;        // Full FeatureServer/0 URL
  id_field: string;        // e.g. "PERMIT_NUMBER"
  type_field: string;
  status_field: string;
  desc_field: string;
  address_field: string;
  date_field: string;
  value_field: string;
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: { x: number; y: number } | null;
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message: string };
  exceededTransferLimit?: boolean;
}

async function fetchArcGISPage(
  baseUrl: string,
  offset: number,
  limit: number = 1000
): Promise<ArcGISResponse> {
  const url = `${baseUrl}/query?where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=${limit}&returnGeometry=true`;

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Henri/1.0 permit-data-scraper" },
      });
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as ArcGISResponse;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("Max retries exceeded");
}

/** Normalise an ArcGIS field value — attributes keys may be UPPER or mixed case */
function getField(attributes: Record<string, unknown>, fieldName: string): string | null {
  // Try exact match first, then case-insensitive
  const val = attributes[fieldName] ?? attributes[fieldName.toLowerCase()] ?? attributes[fieldName.toUpperCase()];
  return val != null ? String(val) : null;
}

export async function scrapeArcGISSource(
  source: ArcGISSource,
  maxPages: number = 20
): Promise<ScrapeResult> {
  const result: ScrapeResult = { inserted: 0, updated: 0, errors: 0 };
  const supabase = createAdminClient();
  const BATCH_SIZE = 100;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 1000;
    let data: ArcGISResponse;

    try {
      data = await fetchArcGISPage(source.endpoint, offset);
    } catch (err) {
      logger.error("ArcGIS fetch error", {
        source_key: source.source_key,
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      result.errors++;
      break;
    }

    if (data.error) {
      logger.error("ArcGIS API error", {
        source_key: source.source_key,
        error: data.error.message,
      });
      break;
    }

    const features = data.features ?? [];
    if (features.length === 0) break;

    const seen = new Set<string>();
    const normalized = features
      .map((feature): Record<string, unknown> | null => {
        try {
          const attr = feature.attributes;
          const rawId = getField(attr, source.id_field);
          if (!rawId) return null;

          // ArcGIS feeds sometimes emit the same permit twice in one page
          // (different inspection rows, for instance). Upsert errors with
          // "cannot affect row a second time" unless we dedupe.
          const key = `${source.city.toLowerCase()}_${rawId}`;
          if (seen.has(key)) return null;
          seen.add(key);

          const rawAddress = getField(attr, source.address_field) ?? "";
          const rawDate = getField(attr, source.date_field);
          const rawValue = getField(attr, source.value_field);

          // ArcGIS geometry: x = longitude, y = latitude
          const geomLng = feature.geometry?.x ?? null;
          const geomLat = feature.geometry?.y ?? null;

          // Validate WGS84 bounds (skip state-plane / web-mercator / projected
          // coords — Louisville etc. ship EPSG:3857 geometry but include real
          // lat/lng as attributes too).
          let lat = geomLat !== null && Math.abs(geomLat) <= 90 ? geomLat : null;
          let lng = geomLng !== null && Math.abs(geomLng) <= 180 ? geomLng : null;

          if (lat === null || lng === null) {
            const attrLatRaw = attr.LATITUDE ?? attr.latitude ?? attr.Latitude;
            const attrLngRaw = attr.LONGITUDE ?? attr.longitude ?? attr.Longitude;
            const attrLat = attrLatRaw != null ? parseCoord(attrLatRaw) : null;
            const attrLng = attrLngRaw != null ? parseCoord(attrLngRaw) : null;
            if (attrLat !== null && Math.abs(attrLat) <= 90) lat = attrLat;
            if (attrLng !== null && Math.abs(attrLng) <= 180) lng = attrLng;
          }

          return {
            source_id:       `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`,
            source_city:     source.city,
            city:            source.city,
            state:           source.state,
            source_type:     "arcgis",
            permit_number:   rawId,
            permit_type:     classifyPermitType(getField(attr, source.type_field) ?? ""),
            status:          normalizeStatus(getField(attr, source.status_field) ?? ""),
            description:     getField(attr, source.desc_field),
            address:         rawAddress || null,
            zip:             (rawAddress ? extractZip(rawAddress) : null) ?? (() => {
              // Fallback to explicit ZIPCODE / ZIP attributes when the
              // address field doesn't carry one (Louisville etc.).
              const raw = attr.ZIPCODE ?? attr.ZIP ?? attr.zipcode ?? attr.zip;
              if (raw == null) return null;
              const m = String(raw).match(/\b(\d{5})\b/);
              return m ? m[1] : null;
            })(),
            latitude:        lat,
            longitude:       lng,
            issued_date:     parseDate(rawDate),
            estimated_value: parseMoney(rawValue),
            contractor_name: null,
            raw_json:        attr,
            updated_at:      new Date().toISOString(),
          };
        } catch {
          result.errors++;
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null);

    // Upsert in batches
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);
      const { data: upserted, error } = await supabase
        .from("permits")
        .upsert(batch, { onConflict: "source_city,source_id" })
        .select("id");

      if (error) {
        result.errors += batch.length;
        logger.error("ArcGIS upsert error", {
          source_key: source.source_key,
          error: error.message,
        });
      } else {
        result.updated += upserted?.length ?? 0;
      }
    }

    // Stop if we got fewer records than the page size (last page)
    if (features.length < 1000 || !data.exceededTransferLimit) break;
  }

  return result;
}
