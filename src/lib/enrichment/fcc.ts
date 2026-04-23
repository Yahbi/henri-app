/**
 * FCC Area API — maps lat/lng to county FIPS code (free, no auth required).
 * Used to determine which county assessor to query for property enrichment.
 */

interface FCCAreaResult {
  stateFips: string;
  countyFips: string;
  countyName: string;
  stateName: string;
}

const fccCache = new Map<string, FCCAreaResult>();

export async function getCountyFIPS(
  lat: number,
  lng: number,
): Promise<FCCAreaResult | null> {
  // Round to 3 decimals (~110m precision) for cache key
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = fccCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`,
      { next: { revalidate: 86400 } }, // Cache 24h
    );

    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;

    const record: FCCAreaResult = {
      stateFips: result.state_fips ?? "",
      countyFips: `${result.state_fips ?? ""}${result.county_fips ?? ""}`,
      countyName: result.county_name ?? "",
      stateName: result.state_name ?? "",
    };

    fccCache.set(key, record);
    return record;
  } catch {
    return null;
  }
}
