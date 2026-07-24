/**
 * Property-value sanity guard.
 *
 * County-GIS / Regrid / parcel-sidecar joins occasionally return absurd
 * values — e.g. a hospital parcel's $380.9M "assessed value" attributed to
 * what the product presents as a homeowner lead, or a $0 / negative
 * placeholder. This clamps to a plausible residential range; anything outside
 * it is treated as unknown (null) rather than written, scored, or displayed
 * as fact.
 *
 * The ceiling is deliberately generous ($50M) — genuine ultra-luxury homes
 * sit far below it, while the bad values we've observed are 8–9 figures and
 * clearly commercial/institutional or outright data errors.
 */
export const MAX_PLAUSIBLE_PROPERTY_VALUE = 50_000_000;

/** Fields (on EnrichedContact / lead rows) that carry a dollar property value
 *  and should pass through `sanitizePropertyValue` before being trusted. */
export const PROPERTY_VALUE_FIELDS = new Set<string>([
  "assessed_value",
  "property_value",
  "last_sale_price",
]);

/**
 * Return the value if it's a plausible property dollar amount, else null.
 * Null / non-finite / <= 0 / above the ceiling all collapse to null.
 */
export function sanitizePropertyValue(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  if (value > MAX_PLAUSIBLE_PROPERTY_VALUE) return null;
  return value;
}
