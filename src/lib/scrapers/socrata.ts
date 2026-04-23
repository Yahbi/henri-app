import type { PermitSource } from "./sources";
import type { ScrapeResult } from "@/types/permits";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyPermitType,
  normalizeStatus,
  parseDate,
  extractZip,
  parseCoord,
  parseMoney,
} from "./normalizer";

/** Build Socrata request headers — add app token when available to avoid rate limits */
function socrataHeaders(): Record<string, string> {
  const token = process.env.SOCRATA_APP_TOKEN;
  return token ? { "X-App-Token": token } : {};
}

async function fetchWithRetry(
  url: string,
  retries: number = 3
): Promise<Response> {
  const headers = socrataHeaders();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers });

      if (response.ok) return response;

      // Retry on server errors and rate limits
      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (attempt === retries) throw error;

      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Max retries exceeded");
}

export async function scrapeSocrataSource(
  source: PermitSource,
  pageSize: number = 1000,
  maxPages: number = 20
): Promise<ScrapeResult> {
  const result: ScrapeResult = { inserted: 0, updated: 0, errors: 0 };
  const supabase = createAdminClient();
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const url = `${source.endpoint}?$limit=${pageSize}&$offset=${offset}`;

    let records: Record<string, unknown>[];
    try {
      const response = await fetchWithRetry(url);
      records = await response.json();
    } catch (err) {
      console.error(`Socrata fetch error [${source.city}] page ${page}:`, err);
      result.errors++;
      break;
    }

    if (!records || !records.length) break;

  const normalized = records
    .map((record) => {
      try {
        const rawType = String(record[source.typeField] ?? "");
        const rawStatus = String(record[source.statusField] ?? "");
        const rawAddress = String(record[source.addressField] ?? "");
        const rawDate = record[source.dateField]
          ? String(record[source.dateField])
          : null;
        const rawValue = record[source.valueField]
          ? String(record[source.valueField])
          : null;

        const rawId = String(record[source.idField] ?? "");
        if (!rawId) return null;

        // Socrata pages can contain duplicate permit numbers; dedupe to
        // avoid "ON CONFLICT DO UPDATE command cannot affect row a second
        // time" when the upsert runs.
        const dedupeKey = `${source.city.toLowerCase()}_${rawId}`;
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);

        const lat = parseCoord(record[source.latField]);
        const lng = parseCoord(record[source.lngField]);

        return {
          source_id:       `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`,
          source_city:     source.city,
          city:            source.city,
          state:           source.state,
          source_type:     "socrata",
          permit_number:   rawId || null,
          permit_type:     classifyPermitType(rawType),
          status:          normalizeStatus(rawStatus),
          description:     record[source.descField] ? String(record[source.descField]) : null,
          address:         rawAddress || null,
          zip:             rawAddress ? extractZip(rawAddress) : null,
          // Validate WGS84 bounds — skip state-plane projected coordinates
          latitude:        lat !== null && Math.abs(lat) <= 90 ? lat : null,
          longitude:       lng !== null && Math.abs(lng) <= 180 ? lng : null,
          issued_date:     parseDate(rawDate),
          estimated_value: parseMoney(rawValue),
          scored_at:       null,
          raw_json:        record,
          updated_at:      new Date().toISOString(),
        };
      } catch {
        result.errors++;
        return null;
      }
    })
    .filter(
      (r): r is NonNullable<typeof r> => r !== null && r.source_id !== ""
    );

    if (!normalized.length) {
      // Page had rows but all filtered — keep paging unless it was a full page of junk
      if (records.length < pageSize) break;
      continue;
    }

    // Upsert in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from("permits")
        .upsert(batch, { onConflict: "source_city,source_id" })
        .select("id");

      if (error) {
        result.errors += batch.length;
        console.error(`Upsert error for ${source.city}:`, error.message);
      } else {
        // Supabase upsert does not distinguish insert vs update in response,
        // so we count all successful rows as updates for simplicity
        result.updated += data?.length ?? 0;
      }
    }

    // Stop if we got a short page (last one)
    if (records.length < pageSize) break;
  }

  return result;
}
