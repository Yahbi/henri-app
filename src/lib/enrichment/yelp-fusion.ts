/**
 * Yelp Fusion API
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: Google Places alternative for business phone lookup. Yelp
 * indexes the same commercial universe (SMB contractors especially)
 * and often has phone data where Google returned null.
 *
 * ## Free tier
 *
 *   - 5,000 requests/day (much more generous than Google)
 *   - Requires API key at https://www.yelp.com/developers
 *   - No per-second rate limit published; 5 req/s has been empirically fine
 *
 * Gating: no-op without `YELP_API_KEY`.
 *
 * ## What we get
 *
 *   - display_phone (formatted business phone)
 *   - phone (E.164 format)
 *   - location.display_address (formatted address)
 *   - url (Yelp profile URL — sometimes the only way to get a website
 *     without a follow-up click)
 *   - rating + review_count (weak signal for contractor quality; not
 *     currently used by Henri's scorer but exposed for future use)
 *   - categories (matches Henri's trade taxonomy: "plumbers",
 *     "roofing", "hvac" → roofing trade, etc.)
 *
 * ## Why this AND Google Places
 *
 * Diversification. Google Places has ~70% US-business coverage, Yelp
 * has ~60%, together they cover ~85%. The orchestrator tries Google
 * first (slightly broader dataset), falls back to Yelp when Google
 * returned null or had no phone.
 *
 * ## Failure modes (return null)
 *
 *   - Missing `YELP_API_KEY`
 *   - 429 → trip flag
 *   - No match → null
 *   - Network / timeout
 */

import { logger } from "@/lib/logger";

const YELP_BASE = "https://api.yelp.com/v3";
const REQUEST_TIMEOUT_MS = 8_000;

let rateLimitTripped = false;

export interface YelpResult {
  business_name: string | null;
  business_phone: string | null;
  business_address: string | null;
  website: string | null;              // Yelp's `url` field
  rating: number | null;
  review_count: number | null;
  categories: string[];
  business_status: string | null;
  source: "yelp";
  confidence: number;
}

interface YelpSearchResponse {
  businesses?: Array<{
    id?: string;
    name?: string;
    phone?: string;
    display_phone?: string;
    url?: string;
    rating?: number;
    review_count?: number;
    is_closed?: boolean;
    location?: {
      display_address?: string[];
      address1?: string;
      city?: string;
      state?: string;
      zip_code?: string;
    };
    categories?: Array<{ alias?: string; title?: string }>;
  }>;
  total?: number;
  error?: { code?: string; description?: string };
}

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const clean =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (clean.length !== 10) return null;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

export async function lookupYelp(params: {
  businessName: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<YelpResult | null> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return null;
  if (rateLimitTripped) return null;

  const { businessName, city, state, zip } = params;
  if (!businessName?.trim() || businessName.length < 3) return null;

  // Build location: prefer zip (most precise), fall back to "city, state".
  let location = zip;
  if (!location) {
    if (city && state) location = `${city}, ${state}`;
    else if (city) location = city;
    else if (state) location = state;
    else return null; // Yelp requires location + term
  }

  const url =
    `${YELP_BASE}/businesses/search` +
    `?term=${encodeURIComponent(businessName)}` +
    `&location=${encodeURIComponent(location)}` +
    `&limit=1` +
    `&sort_by=best_match`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    clearTimeout(timer);
    if (res.status === 429) {
      rateLimitTripped = true;
      logger.warn("yelp: 429 rate-limited");
      return null;
    }
    if (!res.ok) return null;

    const body = (await res.json()) as YelpSearchResponse;
    if (body.error) {
      if (body.error.code === "TOO_MANY_REQUESTS_PER_SECOND") {
        rateLimitTripped = true;
      }
      return null;
    }
    const first = body.businesses?.[0];
    if (!first) return null;

    const phone = normalizePhone(first.phone ?? first.display_phone);
    const address = first.location?.display_address?.join(", ") ?? null;
    const categories = (first.categories ?? [])
      .map((c) => c.alias ?? c.title ?? "")
      .filter(Boolean);

    // Confidence: active business with phone = 0.85.
    // Closed or phone-less = 0.5.
    const confidence = first.is_closed ? 0.4 : phone ? 0.85 : 0.5;

    return {
      business_name: first.name ?? null,
      business_phone: phone,
      business_address: address,
      website: first.url ?? null,
      rating: first.rating ?? null,
      review_count: first.review_count ?? null,
      categories,
      business_status: first.is_closed ? "CLOSED" : "OPERATIONAL",
      source: "yelp",
      confidence,
    };
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("yelp fetch failed", { error: (e as Error).message });
    }
    return null;
  }
}
