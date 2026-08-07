/**
 * `parcel_sources.field_map` → `parcels_sidecar` row mapping.
 *
 * Pure + unit-testable: no network, no database. The cron route
 * (/api/cron/parcels-sidecar) owns the I/O; everything that decides what a
 * row LOOKS LIKE lives here so it can be tested without either.
 *
 *
 * WHY AN ALIAS LAYER EXISTS
 * ------------------------
 * `field_map` maps a canonical name (left) to an upstream column (right).
 * Upstream names are never hardcoded anywhere in this file — they come
 * exclusively from the registry row, because the 69 registered sources have
 * entirely heterogeneous upstream schemas.
 *
 * The CANONICAL side, however, is not one vocabulary but two. The seven rows
 * seeded by migration 00085 use the `parcels_sidecar` column names verbatim
 * (`source_parcel_id`, `situs_addr`, `owner_mailing_addr`, `total_appraisal`,
 * `built_year`, …). The 62 rows added by the later research sessions use a
 * different convention (`parcel_id`, `site_address`, `owner_mailing_address`,
 * `total_value`, `year_built`, …) — 264 distinct canonical keys across the
 * registry in total. A loader that understood only one convention would map
 * nothing at all for whichever group it did not speak.
 *
 * So the alias table below translates canonical VARIANTS onto the fifteen
 * real `parcels_sidecar` columns. It is ordered: the first alias that the
 * registry row actually supplies wins, so an exact column-name match always
 * beats a synonym.
 *
 * Unknown canonical keys are not an error and are not dropped — they stay in
 * `raw_json` verbatim, which is exactly what that column is for. Extending
 * the table later re-derives them without a re-fetch.
 *
 *
 * ON THE "AMBIGUOUS" BARE ALIASES
 * -------------------------------
 * `city`, `zip`, `address`, `location` and `town` look like they could mean
 * either the property or the owner's mailing address. Checked against all 69
 * registry rows: every single use is SITUS-side, because mailing fields are
 * always spelled with an explicit `owner_mailing_*` / `owner_*` prefix
 * (CO-STATEWIDE `zip`→`sitAddZip`, ID-WHITESTAR `city`→`propcity`,
 * MO-ST-LOUIS `zip`→`PROP_ZIP` alongside a separate `owner_mailing_zip`).
 * They are therefore safe to alias onto the situs columns. If a future source
 * breaks that convention, the fix is to spell its field_map with the exact
 * `parcels_sidecar` column names, which always take precedence.
 */

/** Every column of `parcels_sidecar` this loader is allowed to write. */
export const SIDECAR_COLUMNS = [
  "source_parcel_id",
  "owner_name",
  "owner_mailing_addr",
  "situs_addr",
  "situs_city",
  "situs_zip",
  "recent_transfer_at",
  "total_appraisal",
  "building_appraisal",
  "land_appraisal",
  "built_year",
  "building_sqft",
  "land_use",
  "occupancy_desc",
  "resident_phone",
] as const;

export type SidecarColumn = (typeof SIDECAR_COLUMNS)[number];

/**
 * Canonical-name variants accepted for each sidecar column, in priority
 * order. First entry is always the real column name.
 */
export const CANONICAL_ALIASES: Record<SidecarColumn, readonly string[]> = {
  source_parcel_id: [
    "source_parcel_id",
    "parcel_id",
    "property_id",
    "account_no",
    "account_number",
    "apn",
    "pin",
    "parcel_number",
    "unique_parcel_id",
    "state_parcel_id",
    "town_parcel_id",
    "tax_id",
    "pid",
  ],
  owner_name: [
    "owner_name",
    "owner_name_1",
    "owner_name_line_1",
    "taxpayer_name",
    "deedholder",
  ],
  owner_mailing_addr: [
    "owner_mailing_addr",
    "owner_mailing_address",
    "owner_mailing_address_1",
    "owner_address",
    "owner_address_1",
    "mail_address",
  ],
  situs_addr: [
    "situs_addr",
    "site_address",
    "site_address_1",
    "property_address",
    "property_location",
    "situs",
    "location",
    "address",
  ],
  situs_city: ["situs_city", "site_city", "location_city", "town_name", "town", "city"],
  situs_zip: ["situs_zip", "site_zip", "zip"],
  recent_transfer_at: [
    "recent_transfer_at",
    "last_sale_date",
    "sale_date",
    "deed_date",
    "transfer_date",
    "recorded_date",
    "deed_recorded",
    "ownership_date",
    "close_date",
  ],
  total_appraisal: [
    "total_appraisal",
    "total_value",
    "total_val",
    "assessed_value",
    "market_value",
    "appraised_value",
    "current_market",
    "fair_market_value",
    "actual_value",
  ],
  building_appraisal: [
    "building_appraisal",
    "building_value",
    "bldg_val",
    "improvement_value",
  ],
  land_appraisal: ["land_appraisal", "land_value", "land_val"],
  built_year: ["built_year", "year_built", "effective_year"],
  building_sqft: [
    "building_sqft",
    "living_area",
    "res_area",
    "bldg_area",
    "gross_building_area",
  ],
  land_use: [
    "land_use",
    "land_use_desc",
    "land_use_text",
    "use_description",
    "property_class_desc",
    "property_use",
  ],
  occupancy_desc: ["occupancy_desc", "use_class", "property_type"],
  resident_phone: ["resident_phone", "phone"],
};

/** Columns written as text. */
const TEXT_COLUMNS = new Set<SidecarColumn>([
  "source_parcel_id",
  "owner_name",
  "owner_mailing_addr",
  "situs_addr",
  "situs_city",
  "land_use",
  "occupancy_desc",
  "resident_phone",
]);

/** Columns written as whole numbers (integer / bigint). */
const NUMERIC_COLUMNS = new Set<SidecarColumn>([
  "total_appraisal",
  "building_appraisal",
  "land_appraisal",
  "built_year",
  "building_sqft",
]);

/** A mapped row, ready to upsert. Optional columns are ABSENT, never null. */
export interface ParcelSidecarRow {
  source_key: string;
  state_code: string;
  source_parcel_id: string;
  raw_json: Record<string, unknown>;
  owner_name?: string;
  owner_mailing_addr?: string;
  situs_addr?: string;
  situs_city?: string;
  situs_zip?: string;
  recent_transfer_at?: string;
  total_appraisal?: number;
  building_appraisal?: number;
  land_appraisal?: number;
  built_year?: number;
  building_sqft?: number;
  land_use?: string;
  occupancy_desc?: string;
  resident_phone?: string;
}

/**
 * Resolve a registry `field_map` into `sidecar column -> upstream column`.
 *
 * Ignores non-string values and entries whose canonical name matches no
 * sidecar column (those survive in `raw_json`).
 */
export function resolveFieldMap(
  fieldMap: Record<string, unknown> | null | undefined,
): Map<SidecarColumn, string> {
  const out = new Map<SidecarColumn, string>();
  if (!fieldMap || typeof fieldMap !== "object") return out;

  // Case-insensitive lookup of the canonical (left-hand) names.
  const supplied = new Map<string, string>();
  for (const [canonical, upstream] of Object.entries(fieldMap)) {
    if (typeof upstream !== "string") continue;
    const trimmed = upstream.trim();
    if (!trimmed) continue;
    supplied.set(canonical.trim().toLowerCase(), trimmed);
  }

  for (const column of SIDECAR_COLUMNS) {
    for (const alias of CANONICAL_ALIASES[column]) {
      const hit = supplied.get(alias);
      if (hit) {
        out.set(column, hit);
        break; // first alias wins — exact column name is always first
      }
    }
  }
  return out;
}

/** Case-insensitive attribute lookup. ArcGIS casing is inconsistent per tenant. */
function lookup(
  upstream: Record<string, unknown>,
  lowerIndex: Map<string, unknown>,
  column: string,
): unknown {
  if (column in upstream) return upstream[column];
  return lowerIndex.get(column.toLowerCase());
}

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  if (!s) return null;
  // Upstream nulls-as-strings are common in ArcGIS exports.
  const lower = s.toLowerCase();
  if (lower === "null" || lower === "n/a" || lower === "none" || lower === "<null>") {
    return null;
  }
  return s;
}

/**
 * Whole-number coercion. Rejects NaN/Infinity and anything outside Postgres
 * `bigint` range, so a junk value can never abort a whole batch.
 */
function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return null;
  return Math.trunc(n);
}

/** Positive integer, used for the year/sqft columns which are `integer`. */
function asSmallInt(v: unknown): number | null {
  const n = asNumber(v);
  if (n == null) return null;
  // `integer` overflow would 22003 the whole batch.
  if (n < -2147483648 || n > 2147483647) return null;
  return n;
}

/**
 * ISO date, or null.
 *
 * Handles the three shapes actually observed across the registry:
 *   - ArcGIS epoch MILLISECONDS (`1583020800000`) — the usual esri date encoding
 *   - ISO / US date strings (`2019-03-01`, `3/1/2019`)
 *   - bare four-digit YEARS (OK-OKLAHOMA-COUNTY ships `saledate: 2019`)
 *
 * A bare year is deliberately REJECTED rather than widened to `YYYY-01-01`.
 * `recent_transfer_at` drives a "this parcel just changed hands" signal; a
 * fabricated January date would move a real November sale by eleven months
 * and the scorer cannot tell the difference. The raw value stays in
 * `raw_json`, so nothing is lost.
 */
export function asIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;

  if (typeof v === "number" || /^-?\d+$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return null;
    // Bare year — see the note above.
    if (Math.abs(n) < 10_000) return null;
    // Anything smaller than ~1e11 is not a plausible millisecond timestamp
    // (1e11 ms = 1973). Treating a seconds-epoch as millis would land in
    // 1970, so reject rather than guess.
    if (Math.abs(n) < 100_000_000_000) return null;
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString().slice(0, 10);
    return isPlausibleDate(iso) ? iso : null;
  }

  const s = asText(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return isPlausibleDate(iso) ? iso : null;
}

/** Guards against 1899/9999 sentinel dates that pollute the transfer signal. */
function isPlausibleDate(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  return year >= 1900 && year <= 2100;
}

/**
 * 5-digit ZIP.
 *
 * ArcGIS serves numeric ZIP columns as numbers, which silently drops the
 * leading zero for every ZIP east of Pennsylvania (07001 -> 7001). The
 * `(state_code, situs_zip)` index and the pre-intent synthesis cron both
 * match on the 5-character form, so pad it back. ZIP+4 is truncated to the
 * 5-digit prefix for the same reason.
 */
export function asZip(v: unknown): string | null {
  const s = asText(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(0, 5);
  if (digits.length >= 3) return digits.padStart(5, "0");
  return null;
}

/**
 * Map ONE upstream record onto a `parcels_sidecar` row.
 *
 * Returns null when the row has no resolvable `source_parcel_id` — that
 * column is NOT NULL and is half of the dedup key, so a row without one
 * cannot be written at all.
 *
 *
 * NULL OMISSION — the reason this function returns a sparse object
 * -----------------------------------------------------------------
 * The upsert runs with PostgREST's `merge-duplicates` resolution, which
 * compiles to `ON CONFLICT (...) DO UPDATE SET col = EXCLUDED.col` for every
 * key PRESENT IN THE PAYLOAD. A key that is absent is left untouched on the
 * existing row; a key that is present with the value `null` OVERWRITES the
 * existing value with null.
 *
 * Parcel feeds refresh quarterly and are not uniformly populated — the same
 * parcel can carry an owner name in one refresh and a blank in the next, and
 * a second source can cover the same (state_code, source_parcel_id). Sending
 * explicit nulls would therefore let a sparser refresh erase enriched contact
 * data that a previous run had correctly captured. That exact failure mode
 * destroyed enriched contact data elsewhere in this codebase, so every
 * optional column here is OMITTED rather than nulled.
 *
 * Omitting a key is only sufficient if the REQUEST omits it too, which is why
 * `groupRowsByShape` below is mandatory rather than an optimisation. See its
 * doc comment for the exact mechanism.
 */
export function mapParcelRow(params: {
  sourceKey: string;
  stateCode: string;
  resolved: Map<SidecarColumn, string>;
  upstream: Record<string, unknown>;
}): ParcelSidecarRow | null {
  const { sourceKey, stateCode, resolved, upstream } = params;

  const lowerIndex = new Map<string, unknown>();
  for (const [k, v] of Object.entries(upstream)) lowerIndex.set(k.toLowerCase(), v);

  const idColumn = resolved.get("source_parcel_id");
  if (!idColumn) return null;
  const sourceParcelId = asText(lookup(upstream, lowerIndex, idColumn));
  if (!sourceParcelId) return null;

  const row: ParcelSidecarRow = {
    source_key: sourceKey,
    state_code: stateCode,
    source_parcel_id: sourceParcelId,
    raw_json: upstream,
  };

  for (const [column, upstreamColumn] of resolved) {
    if (column === "source_parcel_id") continue;
    const raw = lookup(upstream, lowerIndex, upstreamColumn);

    let value: string | number | null;
    if (column === "situs_zip") value = asZip(raw);
    else if (column === "recent_transfer_at") value = asIsoDate(raw);
    else if (column === "built_year" || column === "building_sqft") value = asSmallInt(raw);
    else if (NUMERIC_COLUMNS.has(column)) value = asNumber(raw);
    else if (TEXT_COLUMNS.has(column)) value = asText(raw);
    else value = asText(raw);

    // THE null-omission rule. Never assign null.
    if (value != null) {
      (row as unknown as Record<string, unknown>)[column] = value;
    }
  }

  return row;
}

/**
 * Keep the LAST row per `(state_code, source_parcel_id)`.
 *
 * Postgres raises `ON CONFLICT DO UPDATE command cannot affect row a second
 * time` (21000) when one statement supplies the same conflict key twice, and
 * that aborts the ENTIRE batch, not the duplicate. The state-licenses rotator
 * hit exactly this in 2026-05 and silently produced 0 inserts from 55,715
 * fetched rows for weeks.
 *
 * Several registered parcel feeds do collide: measured over a 2,000-row
 * sample, OK-CANADIAN-COUNTY's `parcel_id` yields 1,976 distinct values and
 * OK-OKLAHOMA-COUNTY's `propertyid` yields 1,970. Deduping is what keeps a
 * feed like that ingesting at all instead of failing whole pages.
 */
export function dedupeParcelRows(rows: ParcelSidecarRow[]): ParcelSidecarRow[] {
  const byKey = new Map<string, ParcelSidecarRow>();
  for (const r of rows) byKey.set(`${r.state_code}|${r.source_parcel_id}`, r);
  return [...byKey.values()];
}

/**
 * Partition rows into groups that all carry exactly the same keys.
 *
 * THIS IS WHAT MAKES NULL OMISSION ACTUALLY WORK. Omitting a key from the
 * row object is not enough on its own, because of how supabase-js builds the
 * request. Verified against the vendored postgrest-js 2.103.2 in this repo
 * (`node_modules/@supabase/postgrest-js/dist/index.cjs`, `upsert`):
 *
 *     const columns = values.reduce((acc, x) => acc.concat(Object.keys(x)), []);
 *     url.searchParams.set("columns", [...new Set(columns)].join(","));
 *
 * The client sends the UNION of every key across the whole array as
 * `?columns=`. PostgREST then compiles `ON CONFLICT DO UPDATE SET col =
 * EXCLUDED.col` for each of those columns, and any row that did not supply
 * one contributes NULL for it. So a single mixed batch silently nulls the
 * missing columns on EVERY row it touches — precisely the erasure this
 * function exists to prevent, and it does not raise an error while doing it.
 *
 * `defaultToNull: false` (`Prefer: missing=default`) does not help: it changes
 * what the INSERT branch substitutes, while the damage happens on the UPDATE
 * branch, which is driven by the same `?columns=` list either way.
 *
 * Grouping first means every request's key union equals the keys actually
 * present, so nothing is nulled. In practice a feed yields very few groups —
 * upstream ArcGIS pages are schema-stable, so rows differ only where an
 * individual value happened to be blank.
 */
export function groupRowsByShape(rows: ParcelSidecarRow[]): ParcelSidecarRow[][] {
  const groups = new Map<string, ParcelSidecarRow[]>();
  for (const r of rows) {
    const signature = Object.keys(r).sort().join(",");
    const bucket = groups.get(signature);
    if (bucket) bucket.push(r);
    else groups.set(signature, [r]);
  }
  return [...groups.values()];
}

/**
 * True when a page of upstream records produced nothing writable — i.e. the
 * `source_parcel_id` mapping is wrong for this feed.
 *
 * Mirrors `isMappingFailure` in lib/scrapers/types.ts: distinguishing "this
 * feed is genuinely exhausted" from "our mapping is broken" is the difference
 * between a silent zero and an actionable one.
 */
export function isParcelMappingFailure(fetched: number, mapped: number): boolean {
  return fetched > 0 && mapped === 0;
}
