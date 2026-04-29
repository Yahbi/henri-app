/**
 * Apollo.io — contractor-only B2B contact enrichment.
 *
 * Phase E (2026-04-26 session): the 13-source orchestrator covers homeowner
 * contact paths exhaustively. The one gap left is permits where a contractor/
 * business pulled the permit (DIY-vs-pro classifier === "contractor") and we
 * still don't have a business phone or owner email after every other free
 * source has run. Apollo's people-match endpoint excels at exactly this case:
 * given a company name + state, it returns the principal's verified work
 * email + direct phone with high recall.
 *
 * ## Cost discipline (this is the whole point of the gating)
 *
 * Apollo bills per-credit. Henri's projected use:
 *   - ~5% of permits classify as contractor-pulled
 *   - of those, ~50% are still missing email/phone after Phase B/C/D
 *   - at full national scale (1000 permits/day) → ~25 calls/day
 *   - 30-day month → ~750/month, well within Apollo's free tier
 *
 * The gating happens TWICE:
 *   1. Orchestrator-level: only call this module when applicant_classification
 *      === "contractor" AND email/phone are still null (caller's job)
 *   2. Module-level: cache 90 days per (business_name, zip) so a re-enrichment
 *      pass on the same lead within 90 days is a no-op
 *
 * ## Failure modes (all return null, no throw — graceful-degrade per CLAUDE.md)
 *
 *   - Missing APOLLO_API_KEY → null (module disabled)
 *   - Process-lifetime rate-limit trip (429) → null until cold restart
 *   - Network / timeout → null
 *   - Person not found → null
 *   - Person found but no contact info revealed → return name-only result
 *
 * ## Why this is NOT in Phase B (parallel)
 *
 * Phase B fires concurrent independent lookups; we'd want to run Apollo in
 * parallel too if it were free. But it costs a credit per call, so we only
 * fire it AFTER everything else has tried — that way, if OpenCorporates,
 * Google Places, or Yelp already populated the contact, Apollo never gets
 * called and we save the credit.
 *
 * API docs: https://apolloapi.com/docs/api/people/match
 */

import { logger } from "@/lib/logger";

const APOLLO_BASE = "https://api.apollo.io/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** Per-lambda-lifetime rate-limit flag. Apollo returns 429 with no-retry-
 *  hint; we cut further calls to avoid burning the budget on retries. */
let rateLimitTripped = false;

/** In-memory cache. Keyed on (normalized business name + zip). */
interface CacheEntry {
  value: ApolloResult | null;
  expires_at: number;
}
const cache = new Map<string, CacheEntry>();

export interface ApolloResult {
  /** Person's full name (the principal of the contractor business). */
  owner_name: string | null;
  owner_first: string | null;
  owner_last: string | null;
  /** Verified work email — usually the primary outcome of an Apollo lookup. */
  email: string | null;
  /** Direct or mobile phone the principal answers. */
  phone: string | null;
  /** Job title for context — "Owner", "President", "Operations Manager". */
  title: string | null;
  /** Apollo's own confidence indicator (verified / unverified). */
  email_status: "verified" | "guessed" | "unavailable" | null;
  /** LinkedIn URL when present — useful for further manual verification. */
  linkedin_url: string | null;
  source: "apollo";
  /** 0..1 confidence score. Verified email + phone → 0.85. */
  confidence: number;
  fetched_at: string;
}

interface ApolloPersonMatch {
  person?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    title?: string | null;
    email?: string | null;
    email_status?: string | null;
    /** Apollo prefixes phone numbers as "phone_numbers": [{ raw_number, type }] */
    phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string; type?: string | null }>;
    /** Direct phone outside the array — varies by API version. */
    direct_phone?: string | null;
    mobile_phone?: string | null;
    linkedin_url?: string | null;
  };
}

interface ApolloError {
  error?: string | { code?: number; message?: string };
}

/** Build a stable cache key from business name + zip. Uppercase + collapse
 *  whitespace so "ACME LLC" and "  acme   llc  " are the same entry. */
function cacheKey(businessName: string, zip: string | null | undefined): string {
  return `${businessName}|${zip ?? ""}`
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick the best phone from Apollo's response. Prefer mobile (highest answer
 *  rate), then direct, then any sanitized number. */
function selectPhone(person: NonNullable<ApolloPersonMatch["person"]>): string | null {
  if (person.mobile_phone) return person.mobile_phone;
  if (person.direct_phone) return person.direct_phone;
  const numbers = person.phone_numbers ?? [];
  // Prefer mobile/cell from the array if present
  const mobile = numbers.find((n) => /mobile|cell/i.test(n.type ?? ""));
  if (mobile?.sanitized_number) return mobile.sanitized_number;
  if (mobile?.raw_number) return mobile.raw_number;
  // Fall back to first sanitized
  for (const n of numbers) {
    if (n.sanitized_number) return n.sanitized_number;
    if (n.raw_number) return n.raw_number;
  }
  return null;
}

/** Map Apollo's email_status string to our enum. */
function classifyEmailStatus(raw: string | null | undefined): ApolloResult["email_status"] {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("verified")) return "verified";
  if (v.includes("guess") || v.includes("likely")) return "guessed";
  if (v.includes("unavailable") || v.includes("locked")) return "unavailable";
  return null;
}

/** Confidence heuristic — verified email + phone is the gold standard. */
function deriveConfidence(
  hasName: boolean,
  hasEmail: boolean,
  hasPhone: boolean,
  emailStatus: ApolloResult["email_status"],
): number {
  if (!hasName) return 0;
  let score = 0.5; // baseline for any name match
  if (hasEmail) {
    score += emailStatus === "verified" ? 0.25 : 0.1;
  }
  if (hasPhone) score += 0.15;
  return Math.min(0.95, score);
}

/**
 * Look up the principal of a contractor business via Apollo's people-match
 * endpoint. Returns null on missing key, rate limit, or no match.
 *
 * @param input.businessName  Contractor company name (e.g. "Henderson Roofing LLC")
 * @param input.state         2-letter US state code; narrows the search
 * @param input.zip           5-digit ZIP for the lead — used for cache key,
 *                            not sent to Apollo (which doesn't support ZIP filter)
 */
export async function lookupBusinessPrincipal(input: {
  businessName: string;
  state?: string | null;
  zip?: string | null;
}): Promise<ApolloResult | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;
  if (rateLimitTripped) return null;

  const businessName = input.businessName?.trim();
  if (!businessName || businessName.length < 3) return null;

  // Cache check before any network. Same business name + zip within 90 days
  // = same answer.
  const key = cacheKey(businessName, input.zip);
  const cached = cache.get(key);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  // Apollo's people-match endpoint takes domain OR organization_name plus
  // optional first/last to narrow. Without a known principal, we use
  // organization_name and let Apollo pick the best-match owner/principal.
  const searchUrl = `${APOLLO_BASE}/people/match?reveal_personal_emails=true`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        organization_name: businessName,
        // Apollo accepts a hint to find owners specifically — improves match
        // quality vs. picking a random employee.
        person_titles: ["Owner", "President", "CEO", "Founder", "Principal"],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) {
      rateLimitTripped = true;
      logger.warn("apollo: 429 rate limit tripped — disabling for lambda lifetime");
      cache.set(key, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (res.status === 404) {
      // No match — cache the negative result so we don't retry for 90 days.
      cache.set(key, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!res.ok) {
      logger.warn("apollo non-200", { businessName: businessName.slice(0, 40), status: res.status });
      cache.set(key, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const data = (await res.json()) as ApolloPersonMatch & ApolloError;
    if (data.error || !data.person) {
      cache.set(key, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const p = data.person;
    const fullName = (p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()) || null;
    const phone = selectPhone(p);
    const emailStatus = classifyEmailStatus(p.email_status);
    const confidence = deriveConfidence(
      !!fullName,
      !!p.email,
      !!phone,
      emailStatus,
    );

    const result: ApolloResult = {
      owner_name: fullName,
      owner_first: p.first_name ?? null,
      owner_last: p.last_name ?? null,
      email: p.email ?? null,
      phone,
      title: p.title ?? null,
      email_status: emailStatus,
      linkedin_url: p.linkedin_url ?? null,
      source: "apollo",
      confidence,
      fetched_at: new Date().toISOString(),
    };

    cache.set(key, { value: result, expires_at: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name !== "AbortError") {
      logger.warn("apollo fetch failed", {
        businessName: businessName.slice(0, 40),
        error: (err as Error).message,
      });
    }
    cache.set(key, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
    return null;
  }
}
