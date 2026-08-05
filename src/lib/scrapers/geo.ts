/**
 * Coordinate validation shared by every scraper.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * Both scrapers validated latitude and longitude INDEPENDENTLY:
 *
 *     latitude:  lat !== null && Math.abs(lat) <= 90  ? lat : null,
 *     longitude: lng !== null && Math.abs(lng) <= 180 ? lng : null,
 *
 * Nothing required the PAIR. A single coordinate is never real data — it is
 * always a symptom of a wrong field mapping, because a feed that publishes
 * geography publishes both halves. Live evidence: 14,910 permits have a
 * latitude with a NULL longitude, and 1,335 of the "[object Object]" rows
 * carry a junk latitude harvested from a source configured with
 * `lat_field='permit_type'`. Two enabled sources have `lat_field='WYE_NO'`
 * (a sewer-wye identifier).
 *
 * Requiring both halves makes those mappings produce NULL geography instead
 * of a confident, wrong point.
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Return a coordinate pair only when BOTH halves are present, in range, and
 * not the (0, 0) null-island sentinel. Otherwise null.
 *
 * Pure + unit-testable.
 */
export function coordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): Coordinates | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // (0, 0) is in the Gulf of Guinea. No US permit is there; it is the
  // universal "field was empty and got coerced to 0" signature.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
