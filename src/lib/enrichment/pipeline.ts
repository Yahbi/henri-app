import type { EnrichmentResult, EnrichmentQuery } from "./types";
import { getCountyFIPS } from "./fcc";
import { findAssessorByFips } from "./assessor-sources";
import { fetchAssessorData } from "./assessor-fetcher";
import { enrichWithCensus } from "./census-enricher";

/* ── In-memory cache (server-side, 24h TTL) ──────────────────────────────── */

interface CacheEntry {
  result: EnrichmentResult;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cacheKey(q: EnrichmentQuery): string {
  return `${q.address}|${q.zip ?? ""}`.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Main enrichment pipeline.
 *
 * Strategy:
 * 1. Check in-memory cache
 * 2. Use FCC API to determine county FIPS from lat/lng
 * 3. Look up matching county assessor source
 * 4. Fetch assessor data by address
 * 5. Fall back to Census ACS ZIP-level data
 * 6. Cache and return
 */
export async function enrichProperty(
  query: EnrichmentQuery,
  options?: { baseUrl?: string },
): Promise<EnrichmentResult> {
  const key = cacheKey(query);

  // Check cache
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  const emptyResult: EnrichmentResult = {
    property_value: null,
    assessed_value: null,
    year_built: null,
    lot_sqft: null,
    home_sqft: null,
    owner_name: null,
    co_owner: null,
    owner_since: null,
    owner_occupied: null,
    mailing_address: null,
    apn: null,
    source: "none",
  };

  let result: EnrichmentResult = { ...emptyResult };

  // Step 1: Try county assessor if we have coordinates
  if (query.latitude && query.longitude) {
    try {
      const fcc = await getCountyFIPS(query.latitude, query.longitude);
      if (fcc) {
        const assessorSource = findAssessorByFips(fcc.countyFips);
        if (assessorSource) {
          const assessorResult = await fetchAssessorData(assessorSource, {
            address: query.address,
            lat: query.latitude,
            lng: query.longitude,
          });

          if (assessorResult) {
            result = assessorResult;
          }
        }
      }
    } catch {
      // Assessor lookup failed — fall through to Census
    }
  }

  // Step 2: Census ACS fallback for unfilled fields
  if (query.zip && (result.property_value == null || result.year_built == null)) {
    try {
      const census = await enrichWithCensus(query.zip, options?.baseUrl);
      if (census.property_value != null && result.property_value == null) {
        result.property_value = census.property_value;
      }
      if (census.year_built != null && result.year_built == null) {
        result.year_built = census.year_built;
      }
      // Mark source as census if that's all we have
      if (result.source === "none" && (census.property_value != null || census.year_built != null)) {
        result.source = "census_acs_zip";
      }
    } catch {
      // Census fallback failed — return whatever we have
    }
  }

  // Cache the result
  cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });

  return result;
}

/**
 * Batch enrich multiple queries (limits concurrency to 5).
 */
export async function enrichBatch(
  queries: EnrichmentQuery[],
  options?: { baseUrl?: string },
): Promise<Map<string, EnrichmentResult>> {
  const results = new Map<string, EnrichmentResult>();
  const CONCURRENCY = 5;

  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const batch = queries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((q) => enrichProperty(q, options)),
    );
    batch.forEach((q, idx) => {
      results.set(cacheKey(q), batchResults[idx]);
    });
  }

  return results;
}
