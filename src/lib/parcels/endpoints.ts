/**
 * Upstream query-URL builders for the parcels-sidecar loader.
 *
 * Pure + unit-testable, and deliberately NOT in the route module: a Next 16
 * App Router `route.ts` may only export the HTTP verbs and the recognised
 * segment-config keys, so a helper exported from there would fail the build's
 * route-type check.
 */

/**
 * Build a `/query` URL for an ArcGIS layer.
 *
 * Registry endpoints are inconsistent about the suffix — the migration 00085
 * seeds already end in `/query`, every row added by the later research
 * sessions is the bare layer URL. Normalising here rather than rewriting 69
 * registry rows keeps the change reversible and touches no data.
 *
 * `returnGeometry=false` is not optional: parcel layers ship full polygons,
 * which balloons a 1,000-row page to hundreds of megabytes and blows the
 * fetch budget. The sidecar only ever reads attributes.
 */
export function buildArcgisQueryUrl(
  endpoint: string,
  offset: number,
  pageSize: number,
): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  const base = trimmed.endsWith("/query") ? trimmed : `${trimmed}/query`;
  const sep = base.includes("?") ? "&" : "?";
  return (
    `${base}${sep}where=1%3D1&outFields=*&f=json&returnGeometry=false` +
    `&resultOffset=${offset}&resultRecordCount=${pageSize}`
  );
}

/** Socrata-style paged URL (`$limit` / `$offset`). */
export function buildSocrataUrl(
  endpoint: string,
  offset: number,
  pageSize: number,
): string {
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${sep}$limit=${pageSize}&$offset=${offset}`;
}
