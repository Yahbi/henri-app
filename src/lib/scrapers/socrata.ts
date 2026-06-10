import type { PermitSource } from "./sources";
import type { ScrapeResult } from "@/types/permits";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  classifyPermitType,
  normalizeStatus,
  parseDate,
  extractZip,
  deriveState,
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
    // Freshness fix (2026-06-10): order by the Socrata system field `:id`
    // DESC so each run pulls the NEWEST rows first. Without this, paging
    // from offset 0 in default order only ever saw the oldest ~20k rows
    // of large datasets, so new permits were never ingested. `:id` is a
    // universal system column — safe on every Socrata dataset.
    const url = `${source.endpoint}?$limit=${pageSize}&$offset=${offset}&$order=:id+DESC`;

    let records: Record<string, unknown>[];
    try {
      const response = await fetchWithRetry(url);
      records = await response.json();
    } catch (err) {
      logger.error("Socrata fetch error", {
        city: source.city,
        page,
        error: err instanceof Error ? err.message : String(err),
      });
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

        // ZIP resolution: prefer one parsed from the address, else fall
        // back to a dedicated zip column. BLDS-shaped Socrata datasets
        // (Seattle, Cincinnati, ...) keep the street in `originaladdress1`
        // and the ZIP in a separate column — without this fallback those
        // permits land with no ZIP and can never become leads.
        const resolvedZip = (rawAddress ? extractZip(rawAddress) : null) ?? (() => {
          for (const k of ["zip", "zip_code", "zipcode", "originalzip", "zip5", "postal_code", "postalcode", "site_zip", "property_zip"]) {
            const raw = record[k];
            if (raw == null) continue;
            const m = String(raw).match(/\b(\d{5})\b/);
            if (m) return m[1];
          }
          return null;
        })();

        return {
          source_id:       `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`,
          source_city:     source.city,
          city:            source.city,
          // Derive state from the address/ZIP so a source with a junk
          // 'US' state (e.g. auto-discovered) still yields correct rows.
          state:           deriveState(rawAddress || null, resolvedZip, source.state),
          source_type:     "socrata",
          permit_number:   rawId || null,
          permit_type:     classifyPermitType(rawType),
          status:          normalizeStatus(rawStatus),
          description:     record[source.descField] ? String(record[source.descField]) : null,
          address:         rawAddress || null,
          zip:             resolvedZip,
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
        logger.error("Socrata upsert error", {
          city: source.city,
          error: error.message,
        });
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
