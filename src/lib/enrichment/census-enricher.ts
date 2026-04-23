import type { EnrichmentResult } from "./types";

/**
 * Enrich with Census ACS ZIP-level data as a universal fallback.
 * Provides median_home_value and median_year_built for ANY US ZIP code.
 */
export async function enrichWithCensus(
  zip: string,
  baseUrl?: string,
): Promise<Partial<EnrichmentResult>> {
  try {
    const url = `${baseUrl ?? ""}/api/overlays/census?zip=${zip}`;
    const res = await fetch(url);

    if (!res.ok) return {};

    const json = await res.json();
    const record = json.data?.[0];
    if (!record) return {};

    return {
      property_value: typeof record.median_home_value === "number" ? record.median_home_value : null,
      year_built: typeof record.median_year_built === "number" ? record.median_year_built : null,
      source: "census_acs_zip",
    };
  } catch {
    return {};
  }
}
