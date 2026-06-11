/**
 * Shared haversine distance util.
 *
 * Extracted from the two inline copies that previously lived in
 * `src/app/api/cron/score/route.ts` and `src/lib/matching/engine.ts`.
 * Same formula, same Earth radius (3958.8 mi), so behaviour is identical.
 */

/** Approximate miles between two lat/lng pairs (haversine, 3958.8 mi radius). */
export function haversineMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
