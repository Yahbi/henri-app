/**
 * Cloudmersive — broad validation toolkit.
 *
 * Free tier: 800 requests / month — the most generous of the new free
 * sources. Two highest-value endpoints for Henri:
 *
 *   1. **Phone validation** (parsed_phone_number) — alternative to
 *      Numverify with higher quota
 *   2. **Address validation** (validate_address) — normalize messy
 *      permit addresses into clean USPS-style format
 *
 * ## Setup
 *
 *   1. Sign up at https://www.cloudmersive.com
 *   2. Set CLOUDMERSIVE_API_KEY in Vercel / .env.local
 *   3. 800/mo budget — split ~400 phone, ~400 address
 *
 * ## Pattern
 *
 * - Cache aggressively (30 days for both endpoints)
 * - Returns null on missing key, malformed input, or quota error
 * - Wired into orchestrator Phase B (parallel external)
 */

import { logger } from "@/lib/logger";

const PHONE_ENDPOINT = "https://api.cloudmersive.com/validate/phonenumber/basic";
const ADDRESS_ENDPOINT = "https://api.cloudmersive.com/validate/address/parse";

interface CloudmersivePhoneResponse {
  Successful?: boolean;
  IsValid?: boolean;
  PhoneNumberType?: string;
  CountryCode?: string;
  CountryName?: string;
}

interface CloudmersiveAddressResponse {
  Successful?: boolean;
  Building?: string;
  StreetNumber?: string;
  Street?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  CountryFullName?: string;
}

export interface CloudmersivePhoneResult {
  valid: boolean;
  type: "mobile" | "landline" | "voip" | "unknown" | "invalid";
  source: "cloudmersive";
  fetched_at: string;
}

export interface CloudmersiveAddressResult {
  building: string | null;
  street_number: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Reassembled in USPS-canonical order. */
  normalized: string;
  source: "cloudmersive";
  fetched_at: string;
}

const phoneCache = new Map<string, { value: CloudmersivePhoneResult | null; expires_at: number }>();
const addressCache = new Map<string, { value: CloudmersiveAddressResult | null; expires_at: number }>();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function classifyPhoneType(raw: string | undefined): CloudmersivePhoneResult["type"] {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("mobile")) return "mobile";
  if (t.includes("fixed") || t.includes("landline")) return "landline";
  if (t.includes("voip")) return "voip";
  return "unknown";
}

/** Phone validation. Used as a higher-quota alternative / fallback to
 *  Numverify when its 100/mo budget is exhausted. */
export async function lookupPhoneCloudmersive(
  phoneRaw: string,
): Promise<CloudmersivePhoneResult | null> {
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  if (!apiKey) return null;

  const digits = phoneRaw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const cacheKey = digits;

  const cached = phoneCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  try {
    const res = await fetch(PHONE_ENDPOINT, {
      method: "POST",
      headers: {
        Apikey: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "Henri-Bot/1.0",
      },
      body: JSON.stringify({
        PhoneNumber: digits,
        DefaultCountryCode: "US",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("cloudmersive phone non-200", { status: res.status });
      phoneCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data = (await res.json()) as CloudmersivePhoneResponse;
    if (!data.Successful) {
      phoneCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const result: CloudmersivePhoneResult = {
      valid: data.IsValid ?? false,
      type: data.IsValid ? classifyPhoneType(data.PhoneNumberType) : "invalid",
      source: "cloudmersive",
      fetched_at: new Date().toISOString(),
    };
    phoneCache.set(cacheKey, { value: result, expires_at: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    logger.warn("cloudmersive phone fetch failed", { error: String(err) });
    phoneCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
    return null;
  }
}

/** Address validation + normalization. Catches messy permit-feed addresses
 *  ("123 MAPLE ST APT 4B HARTFORD CT 06106-1234") and returns canonical
 *  USPS form. Useful for dedup + spatial joins. */
export async function lookupAddressCloudmersive(
  addressRaw: string,
): Promise<CloudmersiveAddressResult | null> {
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  if (!apiKey) return null;
  if (!addressRaw || addressRaw.length < 5) return null;

  const cacheKey = addressRaw.trim().toLowerCase();
  const cached = addressCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  try {
    const res = await fetch(ADDRESS_ENDPOINT, {
      method: "POST",
      headers: {
        Apikey: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "Henri-Bot/1.0",
      },
      body: JSON.stringify({ AddressString: addressRaw }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("cloudmersive address non-200", { status: res.status });
      addressCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data = (await res.json()) as CloudmersiveAddressResponse;
    if (!data.Successful) {
      addressCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const parts = [
      [data.StreetNumber, data.Street].filter(Boolean).join(" "),
      data.Building ? `${data.Building}` : null,
      data.City,
      data.StateOrProvince,
      data.PostalCode,
    ].filter((p) => p && p.length > 0);
    const result: CloudmersiveAddressResult = {
      building: data.Building ?? null,
      street_number: data.StreetNumber ?? null,
      street: data.Street ?? null,
      city: data.City ?? null,
      state: data.StateOrProvince ?? null,
      postal_code: data.PostalCode ?? null,
      normalized: parts.join(", "),
      source: "cloudmersive",
      fetched_at: new Date().toISOString(),
    };
    addressCache.set(cacheKey, { value: result, expires_at: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    logger.warn("cloudmersive address fetch failed", { error: String(err) });
    addressCache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
    return null;
  }
}
