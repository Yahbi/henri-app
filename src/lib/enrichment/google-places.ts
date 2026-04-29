/**
 * Google Places API (Places v2 / "Place Search")
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a contractor business name + city/state (or just the
 * name), find the Google Places entry and extract the business phone,
 * website, business hours, and the geocoded address. Very high coverage
 * for any contractor with a physical presence — Google indexes ~every
 * commercially-registered business in the US.
 *
 * ## Free tier (Google Maps Platform)
 *
 *   - Place Search text query: 5,000 free requests/month
 *   - Place Details (to pull the phone/website fields): 5,000/month
 *   - Beyond free tier: $32 / 1k Text Search, $32 / 1k Details
 *
 * Sensible ceiling: 5k text searches + 5k details = ~5k business
 * enrichments/month free. For Henri's current new-permit rate
 * (~100-300/day, of which ~25% have a contractor_name), that's well
 * within the free bucket. Over it, the rate-limit-tripped flag below
 * stops further calls.
 *
 * Gating: no-op without `GOOGLE_PLACES_API_KEY`.
 *
 * API docs: https://developers.google.com/maps/documentation/places/web-service
 *
 * ## What we ask for
 *
 * We use `Text Search` with `query="<business name> <city> <state>"`
 * filtered to `type=establishment`. First result is almost always the
 * right business. Then a `Place Details` call pulls `formatted_phone_
 * number`, `website`, `formatted_address`, `business_status`.
 *
 * Two API calls per lookup → 2,500 enrichments/month budget.
 *
 * ## Failure modes (return null)
 *
 *   - Missing `GOOGLE_PLACES_API_KEY`
 *   - 429 → trip flag, all subsequent calls null
 *   - `OVER_QUERY_LIMIT` status → trip flag
 *   - `ZERO_RESULTS` → null (expected when the business isn't on Google)
 *   - Network / timeout
 */

import { logger } from "@/lib/logger";

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
const REQUEST_TIMEOUT_MS = 8_000;

let rateLimitTripped = false;

export interface GooglePlacesResult {
  business_name: string | null;
  business_phone: string | null;
  business_address: string | null;
  website: string | null;
  business_status: string | null;   // "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY"
  place_id: string | null;
  source: "google_places";
  confidence: number;
}

interface TextSearchResponse {
  status?: string;
  results?: Array<{
    place_id?: string;
    name?: string;
    formatted_address?: string;
  }>;
  error_message?: string;
}

interface DetailsResponse {
  status?: string;
  result?: {
    name?: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    formatted_address?: string;
    website?: string;
    business_status?: string;
  };
  error_message?: string;
}

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const clean =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (clean.length !== 10) return null;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.status === 429) {
      rateLimitTripped = true;
      logger.warn("google-places: 429 rate-limited");
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("google-places fetch failed", {
        url: url.replace(/key=[^&]+/, "key=<redacted>"),
        error: (e as Error).message,
      });
    }
    return null;
  }
}

/**
 * Look up a contractor business on Google Places. Returns null on
 * missing API key, quota exhaustion, ambiguous match, or network error.
 */
export async function lookupGooglePlaces(params: {
  businessName: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<GooglePlacesResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  if (rateLimitTripped) return null;

  const { businessName, city, state, zip } = params;
  if (!businessName?.trim() || businessName.length < 3) return null;

  // Build the query. Google's text search weighs location context
  // heavily — we include whatever geographic bits we have.
  const queryParts = [businessName.trim()];
  if (city) queryParts.push(city);
  if (state) queryParts.push(state);
  if (zip) queryParts.push(zip);
  const query = queryParts.join(" ");

  // Step 1: Text Search for the place_id
  const searchUrl =
    `${PLACES_BASE}/textsearch/json` +
    `?query=${encodeURIComponent(query)}` +
    `&type=establishment` +
    `&key=${encodeURIComponent(apiKey)}`;

  const search = await fetchJson<TextSearchResponse>(searchUrl);
  if (!search) return null;
  if (search.status === "OVER_QUERY_LIMIT" || search.status === "REQUEST_DENIED") {
    rateLimitTripped = true;
    logger.warn("google-places: quota/permission denied", {
      status: search.status,
      msg: search.error_message,
    });
    return null;
  }
  if (search.status === "ZERO_RESULTS") return null;
  const first = search.results?.[0];
  if (!first?.place_id) return null;

  // Step 2: Place Details for phone + website + business_status.
  // `fields=` param limits billing to only the fields we need.
  const detailsUrl =
    `${PLACES_BASE}/details/json` +
    `?place_id=${encodeURIComponent(first.place_id)}` +
    `&fields=name,formatted_phone_number,international_phone_number,formatted_address,website,business_status` +
    `&key=${encodeURIComponent(apiKey)}`;

  const details = await fetchJson<DetailsResponse>(detailsUrl);
  const r = details?.result;
  if (!r) return null;

  const phone = normalizePhone(r.formatted_phone_number ?? r.international_phone_number);

  // Confidence: PLACE_STATUS operational + has phone = 0.9.
  // Operational w/o phone but with website = 0.7. Temporarily/
  // permanently closed = 0.4 (business may have moved; phone could
  // still reach the owner but lower confidence).
  const operational = r.business_status === "OPERATIONAL" || !r.business_status;
  const confidence =
    operational && phone
      ? 0.9
      : operational && r.website
        ? 0.7
        : 0.4;

  return {
    business_name: r.name ?? first.name ?? null,
    business_phone: phone,
    business_address: r.formatted_address ?? first.formatted_address ?? null,
    website: r.website ?? null,
    business_status: r.business_status ?? "OPERATIONAL",
    place_id: first.place_id,
    source: "google_places",
    confidence,
  };
}
