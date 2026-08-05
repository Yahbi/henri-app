/**
 * Shared normaliser for flat-JSON permit feeds (Socrata + CKAN datastore).
 *
 * Both APIs return an array of flat objects keyed by column name, so the
 * record -> `permits` row mapping is identical. It used to live inline in
 * socrata.ts; extracting it here means the new CKAN path (which previously
 * did not exist at all — CKAN sources were mis-dispatched into the Socrata
 * scraper and silently produced nothing) reuses the exact same, already
 * battle-tested field handling instead of a second divergent copy.
 */

import type { PermitSource } from "./sources";
import {
  classifyPermitType,
  normalizeStatus,
  parseDate,
  extractZip,
  deriveState,
  parseCoord,
  parseMoney,
} from "./normalizer";
import { coordinatePair } from "./geo";
import { extractContactWithProvenance } from "@/lib/ingest/extract-contact";

/** Dedicated ZIP columns seen across BLDS-shaped Socrata / CKAN datasets. */
const ZIP_FALLBACK_KEYS = [
  "zip",
  "zip_code",
  "zipcode",
  "originalzip",
  "zip5",
  "postal_code",
  "postalcode",
  "site_zip",
  "property_zip",
  "mail_zip",
] as const;

/** LA-shaped street component columns, used to rebuild a street address. */
const STREET_NUMBER_KEYS = ["address_start", "street_number", "house_no", "house__", "house_number"] as const;
const STREET_DIR_KEYS = ["street_direction", "street_dir", "direction"] as const;
const STREET_NAME_KEYS = ["street_name", "streetname"] as const;
const STREET_SUFFIX_KEYS = ["street_suffix", "street_type", "suffix"] as const;

export interface NormalizedFlatRow {
  /** The permit row ready for upsert, or null when no ID could be resolved. */
  row: Record<string, unknown> | null;
  /**
   * True when the row carries an ID *and* an address or an issue date.
   * Drives mapping-failure detection: a full page of ID-only rows means the
   * address/date columns are misconfigured, not that the city is quiet.
   */
  usable: boolean;
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = record[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

export interface ResolvedAddress {
  address: string | null;
  /** ZIP found INSIDE a structured location object — trustworthy. */
  zip: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Read the mapped address column, which is NOT always a string.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * The old code was `String(record[source.addressField] ?? "")` with no type
 * guard. Socrata `location` / `point` columns are OBJECTS, so the address
 * column was written as the literal text "[object Object]". Live count at
 * the time of the fix: 126,754 permits (126,663 Los Angeles + 91 Buffalo),
 * 100% of them with `zip IS NULL` and 100% of them still carrying the real
 * data in `raw_json.location_1`. Because the ZIP was null the scorer skipped
 * every one of them, so all 126,754 were silently absent from the lead
 * pipeline — 5.7% of the permit corpus. 224 enabled sources have
 * `address_field='location_1'` and would keep minting more.
 *
 * Socrata ships location objects in two shapes, both handled here:
 *   GeoJSON:  { type: "Point", coordinates: [lng, lat] }
 *   Legacy:   { latitude, longitude, human_address: "{\"address\":..,\"zip\":..}" }
 *
 * When neither yields a street, we rebuild it from the component columns
 * (address_start + street_direction + street_name + street_suffix), exactly
 * as the sibling src/lib/permits/fetcher.ts already did.
 *
 * Pure + exported for unit tests.
 */
export function resolveAddress(
  record: Record<string, unknown>,
  addressField: string,
): ResolvedAddress {
  const raw = record[addressField];
  let address: string | null = null;
  let zip: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  if (raw != null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // GeoJSON Point: coordinates are [lng, lat].
    const coords = obj.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      lng = parseCoord(coords[0]);
      lat = parseCoord(coords[1]);
    }
    // Legacy shape carries its own lat/lng strings.
    if (lat === null) lat = parseCoord(obj.latitude);
    if (lng === null) lng = parseCoord(obj.longitude);

    // human_address is a JSON *string* nested inside the object.
    const human = obj.human_address;
    if (typeof human === "string" && human.trim()) {
      try {
        const parsed = JSON.parse(human) as Record<string, unknown>;
        const street = parsed.address != null ? String(parsed.address).trim() : "";
        if (street) address = street;
        const z = parsed.zip != null ? String(parsed.zip).trim() : "";
        const m = z.match(/\b(\d{5})\b/);
        if (m) zip = m[1];
      } catch {
        // Malformed human_address — fall through to component rebuild.
      }
    } else if (human != null && typeof human === "object") {
      const parsed = human as Record<string, unknown>;
      const street = parsed.address != null ? String(parsed.address).trim() : "";
      if (street) address = street;
      const m = String(parsed.zip ?? "").match(/\b(\d{5})\b/);
      if (m) zip = m[1];
    }
  } else if (raw != null) {
    const s = String(raw).trim();
    address = s || null;
  }

  // Never persist the stringified-object sentinel, whatever produced it.
  if (address === "[object Object]") address = null;

  if (!address) {
    const num = firstString(record, STREET_NUMBER_KEYS);
    const dir = firstString(record, STREET_DIR_KEYS);
    const name = firstString(record, STREET_NAME_KEYS);
    const suffix = firstString(record, STREET_SUFFIX_KEYS);
    const constructed = [num, dir, name, suffix].filter(Boolean).join(" ").trim();
    if (constructed.length > 2) address = constructed;
  }

  return { address, zip, lat, lng };
}

export interface ResolvedZip {
  zip: string | null;
  /**
   * True when the ZIP came from a structured column or a location object.
   * A ZIP scraped out of free text is NOT trusted for state derivation —
   * see deriveState's `zipIsTrusted` parameter.
   */
  trusted: boolean;
}

/**
 * Resolve the ZIP, preferring a dedicated column over parsing free text.
 *
 * The old order was inverted (`extractZip(address) ?? column`), and because
 * the broken extractZip always returned SOMETHING for an address starting
 * with a 5-digit house number, the structured column was never consulted —
 * on exactly the BLDS-shaped feeds the fallback was written for.
 *
 * Pure + exported for unit tests.
 */
export function resolveZip(
  record: Record<string, unknown>,
  rawAddress: string,
  locationZip: string | null,
): ResolvedZip {
  if (locationZip) return { zip: locationZip, trusted: true };
  for (const k of ZIP_FALLBACK_KEYS) {
    const raw = record[k];
    if (raw == null) continue;
    const m = String(raw).match(/\b(\d{5})\b/);
    if (m) return { zip: m[1], trusted: true };
  }
  const fromAddress = rawAddress ? extractZip(rawAddress) : null;
  return { zip: fromAddress, trusted: false };
}

/**
 * Map one flat record to a `permits` row.
 *
 * Returns `{ row: null, usable: false }` when no ID is resolvable — the
 * caller counts those as skipped, which is what feeds mapping-failure
 * detection.
 */
export function normalizeFlatRecord(
  record: Record<string, unknown>,
  source: PermitSource,
  sourceType: "socrata" | "ckan",
): NormalizedFlatRow {
  const rawId = String(record[source.idField] ?? "").trim();
  if (!rawId) return { row: null, usable: false };

  const rawType = String(record[source.typeField] ?? "");
  const rawStatus = String(record[source.statusField] ?? "");
  const rawDate = record[source.dateField] != null ? String(record[source.dateField]) : null;
  const rawValue = record[source.valueField] != null ? String(record[source.valueField]) : null;

  const loc = resolveAddress(record, source.addressField);
  const rawAddress = loc.address ?? "";
  const { zip: resolvedZip, trusted: zipTrusted } = resolveZip(record, rawAddress, loc.zip);

  // Coordinates: prefer the mapped lat/lng columns, then the location object.
  // The pair is validated together — see geo.ts for why a lone latitude is
  // always a mapping bug rather than real data.
  const geo =
    coordinatePair(parseCoord(record[source.latField]), parseCoord(record[source.lngField])) ??
    coordinatePair(loc.lat, loc.lng);

  const issuedDate = parseDate(rawDate);

  const row: Record<string, unknown> = {
    source_id: `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`,
    source_city: source.city,
    city: source.city,
    // Derive state from the address/ZIP so a source with a junk 'US' state
    // (e.g. auto-discovered) still yields correct rows — but never let a
    // free-text-parsed ZIP override the source's own declared state.
    state: deriveState(rawAddress || null, resolvedZip, source.state, zipTrusted),
    source_type: sourceType,
    permit_number: rawId,
    permit_type: classifyPermitType(rawType),
    status: normalizeStatus(rawStatus),
    description: record[source.descField] != null ? String(record[source.descField]) : null,
    address: rawAddress || null,
    // `zip`, `latitude` and `longitude` are DELIBERATELY ABSENT here and are
    // added below only when this fetch actually produced a value.
    //
    // They used to be unconditional (`zip: resolvedZip`, `latitude:
    // geo?.lat ?? null`). The upsert runs with merge-duplicates, i.e.
    // ON CONFLICT DO UPDATE SET every supplied column, so a re-scrape whose
    // mapping yielded no ZIP wrote `SET zip = NULL` over a ZIP that was
    // already there — silently destroying it.
    //
    // That erased backfilled data on a schedule. /api/cron/census-geocode
    // exists to resolve missing ZIPs from the Census geocoder, and scrape
    // runs every hour over the same sources, so each geocoded ZIP survived
    // only until its source was next scraped. Observed directly on
    // production 2026-08-05: distinct permit ZIPs fell from 18,040 to 16,551
    // across two scrape runs, while the geocoder was ADDING ZIPs. A net loss
    // of 1,489 ZIPs, each one a permit that can no longer match a territory
    // and therefore can no longer become a lead.
    //
    // This is exactly the reasoning already applied to the contact columns
    // below — "a key that is absent is left untouched by ON CONFLICT DO
    // UPDATE, so a sparse re-fetch can never blank a value an enrichment
    // pass already won" — which was correct, and simply had not been applied
    // to the three geo columns that an enrichment pass actually fills.
    issued_date: issuedDate,
    estimated_value: parseMoney(rawValue),
    // `scored_at` is DELIBERATELY ABSENT.
    //
    // It used to be `scored_at: null`. Because the upsert runs with
    // merge-duplicates (ON CONFLICT DO UPDATE SET every supplied column),
    // every re-scrape reset scored_at on already-scored permits, pushing
    // them back into the scorer's queue. The scorer's lead upsert hardcodes
    // `status: "new"` and overwrites `notes`, so a lead a contractor had
    // marked contacted/won reverted to "new" with its notes wiped — while
    // keeping contacted_at/won_at populated. It also re-fired notifications
    // and hot-lead SMS for work already done. `scored_at` must only ever be
    // written by the scorer.
    raw_json: record,
    updated_at: new Date().toISOString(),
  };

  // Denormalised contact columns. The DB-driven scrapers never populated
  // these, so owner names and phone numbers already sitting in raw_json were
  // invisible to both the scorer and the lead drawer (26,873 owner names and
  // 18,804 phone numbers in the Orlando ingest alone).
  //
  // Only NON-NULL values are added to the payload: a key that is absent is
  // left untouched by ON CONFLICT DO UPDATE, so a sparse re-fetch can never
  // blank a value an enrichment pass already won.
  // Geo columns: present only when this fetch resolved one. See the note in
  // the row literal above — writing null here destroys geocoder backfill.
  if (resolvedZip) row.zip = resolvedZip;
  if (geo?.lat != null && geo?.lng != null) {
    row.latitude = geo.lat;
    row.longitude = geo.lng;
  }

  const contact = extractContactWithProvenance(record);
  if (contact.owner_name) row.applicant_name = contact.owner_name;
  else if (contact.applicant_name) row.applicant_name = contact.applicant_name;
  if (contact.contractor_name) row.contractor_name = contact.contractor_name;
  if (contact.owner_name || contact.applicant_name || contact.contractor_name) {
    row.contact_source = contact.source;
    row.contact_confidence = contact.confidence;
    row.contact_extracted_at = new Date().toISOString();
  }

  return { row, usable: Boolean(rawAddress) || issuedDate !== null };
}
