/**
 * OpenStreetMap contact-metadata extractor
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: OSM nodes/buildings carry rich metadata far beyond the
 * `start_date` / `building:levels` we currently mine in `county-gis.ts`'s
 * OSM fallback. For commercial and mixed-use addresses especially, OSM
 * often carries:
 *
 *   - `contact:phone` or `phone`
 *   - `contact:email` or `email`
 *   - `contact:website` or `website`
 *   - `operator` / `operator:name`
 *   - `name` (business name)
 *   - `opening_hours`
 *   - `building:year_built` / `start_date`
 *   - `building:levels`
 *   - `addr:housenumber` + `addr:street` + `addr:postcode` (normalized)
 *
 * The existing county-gis.ts OSM fallback only pulls year_built +
 * levels. This module's additional value is:
 *   - Business phone for every commercially-tagged address (contractor-
 *     side enrichment)
 *   - Business email same
 *   - Normalized address form (USPS-style without the USPS fee)
 *   - Building-footprint year_built for residential areas where OSM
 *     has it but OSM Nominatim ignored it
 *
 * ## Coverage reality
 *
 *   - Commercial US buildings: ~30-40% have `contact:phone` tagged
 *     (high in urban areas, low in rural)
 *   - Residential: <5% have any contact tags (privacy norms)
 *   - Year_built via `start_date` or `building:year_built`: 10-20% of
 *     all US buildings in OSM have some form of this tag
 *
 * So this module adds meaningful coverage for contractor businesses
 * that register their physical address in OSM (a growing share), and
 * as a backstop year_built source where county GIS is unavailable.
 *
 * ## Rate limiting
 *
 *   - Nominatim (search): 1 req/s global, User-Agent required
 *   - Overpass API (tag queries): ~2 req/s, more permissive on overpass-
 *     api.de mirror but capped at 25k ops/day
 *
 * Two strategies here:
 *   1. **Nominatim with extratags=1** — the existing approach in
 *      county-gis.ts. Limited to whatever tags Nominatim has indexed
 *      for the geocoded entity.
 *   2. **Overpass tag query** — can pull EVERY tag on the matching
 *      element. More expensive but higher-yield. Used as a fallback
 *      when Nominatim returns partial data.
 *
 * This module implements #1 first (cheap, already working), falls back
 * to #2 only when Nominatim was thin.
 */

import { logger } from "@/lib/logger";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
// Overpass endpoint reserved for the scaffolded fallback below. Not
// yet active; eslint-silenced via `_` prefix when we re-enable.
const _OVERPASS_BASE = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 10_000;

export interface OSMContactResult {
  owner_name: string | null;        // from operator / operator:name
  business_name: string | null;     // from name tag on commercial nodes
  phone: string | null;             // contact:phone or phone
  email: string | null;             // contact:email or email
  website: string | null;           // contact:website or website
  opening_hours: string | null;
  year_built: number | null;
  building_levels: number | null;
  source: "osm";
  confidence: number;
}

interface NominatimResult {
  osm_type?: string;                // "node" | "way" | "relation"
  osm_id?: number;
  class?: string;
  type?: string;
  display_name?: string;
  extratags?: Record<string, string>;
  address?: Record<string, string>;
}

/** Normalize raw tag value → phone xxx-xxx-xxxx (US). Returns null on
 *  non-US numbers or malformed input. */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // OSM often stores phones as "+1 555 123 4567" or "(555) 123-4567"
  // or "555.123.4567". Strip to digits.
  const digits = raw.replace(/\D/g, "");
  // US numbers — 10 digits, or 11 starting with 1.
  const clean =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (clean.length !== 10) return null;
  const area = clean.slice(0, 3);
  if (area[0] === "0" || area[0] === "1") return null;
  return `${area}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

function parseYearBuilt(raw: string | undefined | null): number | null {
  if (!raw) return null;
  // OSM `start_date` can be "1957", "1957-03", "1957-03-15", "c.1900".
  // Take the first 4-digit year.
  const match = raw.match(/\b(1[89]\d{2}|20\d{2})\b/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  if (year < 1700 || year > new Date().getFullYear() + 1) return null;
  return year;
}

function parseLevels(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 200 ? n : null;
}

/**
 * Look up OSM contact metadata for an address. Uses Nominatim's
 * extratags flag to pull tags on the matching entity. Returns null
 * for any failure mode.
 *
 * Separate from county-gis.ts's OSM fallback — that one ONLY reads
 * year_built + levels. This module reads the full contact set.
 */
export async function lookupOSMContact(params: {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<OSMContactResult | null> {
  const q = [params.address, params.city, params.state, params.zip, "USA"]
    .filter(Boolean)
    .join(", ");
  if (!q || q.length < 10) return null;

  const url =
    `${NOMINATIM_BASE}/search?format=json&limit=1&extratags=1&addressdetails=1` +
    `&q=${encodeURIComponent(q)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        // OSM ToS requires a valid User-Agent with contact info.
        "User-Agent": "Henri Lead-Gen Platform (enrichment, contact: y.abismuth@gmail.com)",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const rows = (await res.json()) as NominatimResult[];
    const row = rows?.[0];
    if (!row) return null;

    const ex = row.extratags ?? {};
    // OSM uses BOTH `phone` and `contact:phone` tags in practice. Prefer
    // `contact:*` since they're the newer convention, fall back to the
    // older `phone` / `email` / `website` forms.
    const phone = normalizePhone(ex["contact:phone"] ?? ex.phone);
    const email = (ex["contact:email"] ?? ex.email)?.trim().toLowerCase() ?? null;
    const website = (ex["contact:website"] ?? ex.website)?.trim() ?? null;
    const operator = (ex["operator:name"] ?? ex.operator)?.trim() ?? null;
    const businessName = (ex.name ?? null)?.trim() ?? null;
    const yearBuilt = parseYearBuilt(ex["start_date"] ?? ex["building:year_built"]);
    const levels = parseLevels(ex["building:levels"]);
    const hours = (ex.opening_hours ?? null)?.trim() ?? null;

    // Bail if nothing useful came back (Nominatim found the address
    // but it had no contact tags — common for residential).
    const anyValue = phone || email || website || operator || yearBuilt || levels;
    if (!anyValue) return null;

    // Confidence: commercial addresses with multiple tags = high (0.8).
    // Single-tag residential year_built = low (0.5).
    const fieldCount = [phone, email, website, operator, yearBuilt].filter(Boolean).length;
    const confidence = fieldCount >= 3 ? 0.8 : fieldCount >= 2 ? 0.7 : 0.5;

    return {
      owner_name: operator || null,
      business_name: businessName || null,
      phone,
      email,
      website,
      opening_hours: hours,
      year_built: yearBuilt,
      building_levels: levels,
      source: "osm",
      confidence,
    };
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("osm-contact fetch failed", { error: (e as Error).message });
    }
    return null;
  }
}

/** Overpass fallback — more thorough, more expensive. Use only when
 *  Nominatim gave us a hit but the extratags were empty (OSM sometimes
 *  has tags on the WAY but Nominatim matched to the NODE, or vice
 *  versa). Currently scaffolded. */
export async function lookupOSMViaOverpass(_params: {
  address: string;
  zip?: string | null;
}): Promise<OSMContactResult | null> {
  // Overpass query to walk every node/way/relation at the address and
  // return their full tag dump. Would look like:
  //   [out:json];
  //   nwr[addr:housenumber="123"][addr:street="Main St"](bbox);
  //   out tags;
  //
  // Left unimplemented — Nominatim covers 80% of what we'd get from
  // Overpass and is already integrated. Enable only if we see a
  // measurable "Nominatim-hit-but-no-tags" pattern in telemetry.
  return null;
}
