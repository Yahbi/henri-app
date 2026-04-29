/* ── Socrata Permit Fetcher ──────────────────────────────────────────────────
 * Fetches permit records from any Socrata Open Data API endpoint,
 * normalises them into a common shape for database insertion.
 * ────────────────────────────────────────────────────────────────────────── */

import { type PermitSource, type HenriTrade, detectTrade } from "./sources";
import {
  extractContactWithProvenance,
  type ContactSource,
} from "@/lib/ingest/extract-contact";

export interface NormalizedPermit {
  source_id: string;
  city: string;
  state: string;
  address: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  permit_type: string | null;
  permit_number: string | null;
  estimated_value: number | null;
  owner_first: string | null;
  owner_last: string | null;
  description: string | null;
  applied_date: string | null;
  trade: HenriTrade;
  raw_data: Record<string, unknown>;
  /** Provenance of any contact fields populated from `raw_data`. Null
   *  when the upstream parser supplied owner_first/owner_last directly
   *  and no raw-blob fallback was needed. Persisted to
   *  `permits.contact_source` / `permits.contact_confidence` by the
   *  cron. See migration 00039. */
  contact_source: ContactSource | null;
  contact_confidence: number | null;
}

export interface FetchOptions {
  /** Maximum records per request (default 200, max 1000) */
  limit?: number;
  /** Look back N days from today (default 7) */
  daysBack?: number;
  /** Offset for pagination */
  offset?: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function toFloat(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toStr(val: unknown): string | null {
  if (val == null || val === "") return null;
  return String(val).trim();
}

function toDollars(val: unknown): number | null {
  if (val == null) return null;
  const cleaned = String(val).replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function isoDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split("T")[0] + "T00:00:00";
}

/** Try multiple potential column names for a field (fallback logic). */
function resolve(
  row: Record<string, unknown>,
  primary: string | undefined,
  ...fallbacks: string[]
): unknown {
  if (primary && row[primary] != null) return row[primary];
  for (const fb of fallbacks) {
    if (row[fb] != null) return row[fb];
  }
  return null;
}

/** Extract lat/lon from various Socrata geo-column formats. */
function extractCoords(
  row: Record<string, unknown>,
  latField?: string,
  lngField?: string,
): { lat: number | null; lng: number | null } {
  // Direct numeric fields
  let lat = toFloat(resolve(row, latField, "latitude", "lat", "y"));
  let lng = toFloat(resolve(row, lngField, "longitude", "lng", "lon", "x"));

  // Some Socrata datasets embed coordinates inside a "location" object
  if (lat == null || lng == null) {
    const loc = row.location as Record<string, unknown> | null;
    if (loc) {
      if (loc.latitude != null) lat = toFloat(loc.latitude);
      if (loc.longitude != null) lng = toFloat(loc.longitude);
      // GeoJSON-style { coordinates: [lng, lat] }
      const coords = loc.coordinates as number[] | null;
      if (coords && Array.isArray(coords) && coords.length >= 2) {
        lng = lng ?? toFloat(coords[0]);
        lat = lat ?? toFloat(coords[1]);
      }
    }
  }

  // Some datasets have a "geocoded_column" point field
  const geo = row.geocoded_column as Record<string, unknown> | null;
  if ((lat == null || lng == null) && geo) {
    const coords = geo.coordinates as number[] | null;
    if (coords && Array.isArray(coords) && coords.length >= 2) {
      lng = lng ?? toFloat(coords[0]);
      lat = lat ?? toFloat(coords[1]);
    }
  }

  // Validate range
  if (lat != null && (lat < -90 || lat > 90)) lat = null;
  if (lng != null && (lng < -180 || lng > 180)) lng = null;

  return { lat, lng };
}

/** Split "FIRST LAST" or "LAST, FIRST" into parts. */
function splitOwnerName(name: string | null): {
  first: string | null;
  last: string | null;
} {
  if (!name) return { first: null, last: null };
  const trimmed = name.trim();
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",").map((s) => s.trim());
    return { first: first || null, last: last || null };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return { first: parts[0], last: parts.slice(1).join(" ") };
  }
  return { first: null, last: trimmed };
}

/* ── Main fetch function ─────────────────────────────────────────────────── */

export async function fetchPermits(
  source: PermitSource,
  options: FetchOptions = {},
): Promise<NormalizedPermit[]> {
  const limit = Math.min(options.limit ?? 200, 1000);
  const daysBack = options.daysBack ?? 7;
  const offset = options.offset ?? 0;
  const fm = source.fieldMap;

  const sinceDate = isoDate(daysBack);

  // Build SODA query — try the date field with a $where clause
  const params = new URLSearchParams({
    $limit: String(limit),
    $offset: String(offset),
    $order: `${fm.issued_date} DESC`,
    $where: `${fm.issued_date} > '${sinceDate}'`,
  });

  const url = `https://${source.domain}/resource/${source.datasetId}.json?${params}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Henri-Permit-Ingestion/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `[${source.id}] Socrata request failed: ${response.status} ${response.statusText}`,
    );
  }

  const rows: Record<string, unknown>[] = await response.json();

  if (!Array.isArray(rows)) {
    throw new Error(`[${source.id}] Unexpected response format — expected array`);
  }

  return rows.map((row): NormalizedPermit => {
    const { lat, lng } = extractCoords(row, fm.latitude, fm.longitude);

    // Owner name handling — some datasets have full name, some have first/last
    let ownerFirst = toStr(resolve(row, fm.owner_first, "owner_first_name", "applicant_first_name"));
    let ownerLast = toStr(resolve(row, fm.owner_last, "owner_last_name", "applicant_last_name"));

    if (!ownerFirst && !ownerLast) {
      const fullName = toStr(
        resolve(row, fm.owner_name, "owner_name", "applicant_name", "contractor_name", "contact_name"),
      );
      const parts = splitOwnerName(fullName);
      ownerFirst = parts.first;
      ownerLast = parts.last;
    }

    // Ultimate fallback — the multi-city raw extractor. Catches the
    // long tail of field-naming variants (owner_s_first_name on NYC,
    // ownername on Baton Rouge, permittee_s_business_name, etc.) that
    // aren't covered by the fm / resolve() priority lists above. Pure
    // in-row read, no extra network calls.
    //
    // Run it unconditionally so we can attach provenance
    // (`contact_source` / `contact_confidence`) to every NormalizedPermit,
    // but only OVERWRITE owner_first/owner_last when the structured
    // upstream fields were empty — same behavior as before.
    const rawContact = extractContactWithProvenance(row);
    if (!ownerFirst && !ownerLast) {
      ownerFirst = rawContact.owner_first ?? "";
      ownerLast = rawContact.owner_last ?? "";
      if (!ownerFirst && !ownerLast && rawContact.owner_name) {
        const parts = splitOwnerName(rawContact.owner_name);
        ownerFirst = parts.first;
        ownerLast = parts.last;
      }
    }

    // Build description text from available fields
    const descriptionText = toStr(resolve(row, fm.description, "description", "work_description", "scope_of_work"));
    const permitTypeText = toStr(resolve(row, fm.permit_type, "permit_type", "type", "work_type"));

    // Detect trade from description + permit type
    const trade = detectTrade(
      [descriptionText, permitTypeText].filter(Boolean).join(" "),
      source.tradeKeywords,
    );

    // Clean address — try primary field, then construct from street components
    let address = toStr(resolve(row, fm.address, "address", "primary_address", "originaladdress1", "street_address"));

    // If address is missing or is "[object Object]", construct from components
    if (!address || address === "[object Object]") {
      const num = toStr(resolve(row, fm.street_number, "street_number", "house_no", "house__"));
      const dir = toStr(resolve(row, fm.street_direction, "street_direction"));
      const name = toStr(resolve(row, fm.street_name_field, "street_name"));
      const constructed = [num, dir, name].filter(Boolean).join(" ");
      if (constructed.length > 2) address = constructed;
    }

    if (address) {
      // Strip trailing city/state that some datasets append
      address = address.replace(/,?\s*(IL|CA|WA|TX|NY|OH|LA|MO|MA|HI)\s*\d{5}.*$/i, "").trim();
    }

    // Extract ZIP — try the field, then parse from address
    let zip = toStr(resolve(row, fm.zip, "zip_code", "zip", "zipcode", "postal_code"));
    if (!zip && address) {
      const zipMatch = address.match(/\b(\d{5})\b/);
      if (zipMatch) zip = zipMatch[1];
    }

    return {
      source_id: `socrata_${source.id}`,
      city: source.city,
      state: source.state,
      address,
      zip,
      latitude: lat,
      longitude: lng,
      permit_type: permitTypeText,
      permit_number: toStr(resolve(row, fm.permit_number, "permit_number", "permit_no", "permit_")),
      estimated_value: toDollars(resolve(row, fm.permit_value, "estimated_cost", "valuation", "est_cost")),
      owner_first: ownerFirst,
      owner_last: ownerLast,
      contact_source: rawContact.source,
      contact_confidence: rawContact.confidence,
      description: descriptionText,
      applied_date: toStr(resolve(row, fm.issued_date, "issue_date", "issued_date", "approved_date")),
      trade,
      raw_data: row,
    };
  });
}
