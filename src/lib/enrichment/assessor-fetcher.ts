import type { AssessorSource, EnrichmentResult } from "./types";

/**
 * Normalize an address for Socrata SoQL matching.
 * Strips unit/apt/suite, standardizes common abbreviations.
 */
function normalizeAddress(addr: string): string {
  return addr
    .toUpperCase()
    .replace(/\s+(APT|UNIT|STE|SUITE|#)\s*\S*/gi, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch property data from a Socrata county assessor dataset.
 * Tries address matching first, then falls back to spatial query if lat/lng provided.
 */
export async function fetchAssessorData(
  source: AssessorSource,
  query: { address: string; lat?: number; lng?: number },
): Promise<EnrichmentResult | null> {
  const { domain, datasetId, fieldMap } = source;
  const normalized = normalizeAddress(query.address);

  // Select only the fields we need
  const selectFields = [
    fieldMap.address,
    fieldMap.assessed_value,
    fieldMap.property_value,
    fieldMap.year_built,
    fieldMap.lot_sqft,
    fieldMap.home_sqft,
    fieldMap.owner_name,
    fieldMap.co_owner,
    fieldMap.mailing_address,
    fieldMap.sale_date,
    fieldMap.apn,
  ].filter((f): f is string => f != null);

  const selectStr = selectFields.join(",");

  // Try 1: Address match via SoQL
  const whereClause = `upper(${fieldMap.address}) LIKE '%${normalized}%'`;
  const url = `https://${domain}/resource/${datasetId}.json?$select=${selectStr}&$where=${encodeURIComponent(whereClause)}&$limit=1`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 }, // Cache 24h
    });

    if (res.ok) {
      const rows = await res.json();
      if (rows?.length > 0) {
        return parseRow(rows[0], source);
      }
    }
  } catch {
    // Fall through to spatial query
  }

  // Try 2: Spatial query if lat/lng available
  if (query.lat && query.lng) {
    try {
      const spatialUrl = `https://${domain}/resource/${datasetId}.json?$select=${selectStr}&$where=within_circle(location, ${query.lat}, ${query.lng}, 100)&$limit=1`;
      const res = await fetch(spatialUrl, {
        headers: { Accept: "application/json" },
        next: { revalidate: 86400 },
      });

      if (res.ok) {
        const rows = await res.json();
        if (rows?.length > 0) {
          return parseRow(rows[0], source);
        }
      }
    } catch {
      // Spatial queries aren't supported on all datasets
    }
  }

  return null;
}

/**
 * Parse a raw assessor row into an EnrichmentResult.
 */
function parseRow(
  row: Record<string, unknown>,
  source: AssessorSource,
): EnrichmentResult {
  const fm = source.fieldMap;

  const assessedRaw = fm.assessed_value ? toNum(row[fm.assessed_value]) : null;
  const propertyRaw = fm.property_value ? toNum(row[fm.property_value]) : null;
  const yearBuiltRaw = fm.year_built ? toNum(row[fm.year_built]) : null;

  let lotSqft: string | null = null;
  if (fm.lot_sqft) {
    const raw = toNum(row[fm.lot_sqft]);
    if (raw != null) {
      // Convert acres to sqft if needed
      lotSqft = fm.lot_in_acres
        ? String(Math.round(raw * 43560))
        : String(Math.round(raw));
    }
  }

  const homeSqft = fm.home_sqft ? toStr(row[fm.home_sqft]) : null;
  const ownerName = fm.owner_name ? toStr(row[fm.owner_name]) : null;
  const coOwner = fm.co_owner ? toStr(row[fm.co_owner]) : null;
  const mailingAddr = fm.mailing_address ? toStr(row[fm.mailing_address]) : null;
  const saleDate = fm.sale_date ? toStr(row[fm.sale_date]) : null;
  const apn = fm.apn ? toStr(row[fm.apn]) : null;

  // Determine owner_occupied: if mailing address matches situs address
  const situsAddr = fm.address ? toStr(row[fm.address]) : null;
  let ownerOccupied: boolean | null = null;
  if (mailingAddr && situsAddr) {
    const normMail = normalizeAddress(mailingAddr);
    const normSitus = normalizeAddress(situsAddr);
    ownerOccupied = normMail.includes(normSitus.substring(0, 10)) ||
      normSitus.includes(normMail.substring(0, 10));
  }

  return {
    property_value: propertyRaw,
    assessed_value: assessedRaw,
    year_built: yearBuiltRaw ? Math.round(yearBuiltRaw) : null,
    lot_sqft: lotSqft,
    home_sqft: homeSqft ? String(Math.round(Number(homeSqft))) : null,
    owner_name: ownerName,
    co_owner: coOwner,
    owner_since: saleDate ? saleDate.split("T")[0] : null,
    owner_occupied: ownerOccupied,
    mailing_address: mailingAddr,
    apn,
    source: source.id,
  };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
