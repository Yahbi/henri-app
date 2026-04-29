/**
 * Hunter.io Email Inference
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a contractor business name (from a permit's
 * `contractor_name` / `applicant_name` column) plus a first + last name we
 * already parsed out, try to guess the most-likely email.
 *
 * Hunter.io's free tier gives us 50 domain-search requests/month. That's
 * plenty for enrichment-on-demand as long as we:
 *   - only fire when we ALREADY have a first + last name (no point in
 *     guessing `info@…` fallback patterns),
 *   - cache the domain we tried AND the failure mode so we don't re-pay
 *     for the same miss next run,
 *   - graceful-degrade to null on any 429 / 403 / network error — this is
 *     enrichment, not a critical path.
 *
 * Domain extraction is a heuristic: "Smith Plumbing LLC" →
 * `smithplumbing.com`. Good enough for the obvious cases, cheap to skip
 * when the business name is ambiguous (e.g. a street-number LLC). We do
 * NOT try multiple domain variants per call — that would blow through
 * the free tier on misses.
 *
 * Rate-limit handling: a process-lifetime in-memory "skip the rest of this
 * run" flag flips to true on the first 429 / 403. All subsequent calls in
 * the same cron invocation return null immediately without hitting Hunter.
 * The flag resets when the serverless lambda is cold-started next.
 *
 * API: https://hunter.io/api-documentation/v2#domain-search
 */

import { logger } from "@/lib/logger";

export interface EmailInferenceResult {
  email: string | null;
  confidence: number; // 0-1 from Hunter's own score (divided by 100)
  pattern: string | null; // "{first}.{last}@{domain}" etc.
}

/** Set to true when Hunter returns a 429 / 403 in this lambda lifetime.
 *  Prevents wasting further API slots on a bucket we know is exhausted. */
let rateLimitTripped = false;

/** Legal / entity suffixes that we strip before concatenating tokens into
 *  a domain guess. Keep in sync with the broader `business-name-parser`
 *  entity list but limited to the ones that are safe to drop when we're
 *  building a domain (NOT the ones you'd want to preserve for display). */
const DOMAIN_STRIP_SUFFIXES = new Set<string>([
  "llc",
  "l.l.c.",
  "l.l.c",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "pllc",
  "pc",
  "pa",
  "lp",
  "llp",
]);

/** Extract a best-guess domain from a business name.
 *
 *  "Smith Plumbing LLC"    → "smithplumbing.com"
 *  "Acme Roofing, Inc."    → "acmeroofing.com"
 *  "1 Fulton Street LLC"   → null  (starts with a number — ambiguous)
 *  ""                      → null
 *
 *  Conservative by design: we return null when the result is likely to
 *  be wrong, because Hunter charges credits on misses.
 */
export function domainFromBusinessName(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Tokenize; strip punctuation, legal suffixes, empty tokens.
  const tokens = trimmed
    .toLowerCase()
    .split(/[\s,.\-&/]+/)
    .map((t) => t.replace(/[^\w]/g, ""))
    .filter(Boolean)
    .filter((t) => !DOMAIN_STRIP_SUFFIXES.has(t));

  if (!tokens.length) return null;

  // Reject when the name starts with a digit — address-holding LLCs
  // ("1 Fulton Street LLC") produce garbage domains like
  // "1fultonstreet.com" and burn an API slot on a miss.
  if (/^\d/.test(tokens[0])) return null;

  // Single-token name ("Acme") — usable, but confidence is low. We still
  // try, because the Hunter call is cheap relative to the upside if it
  // hits.
  const domainBase = tokens.join("");
  if (domainBase.length < 3) return null;

  return `${domainBase}.com`;
}

interface HunterEmailEntry {
  value: string;
  type?: string;
  confidence?: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
}

interface HunterDomainSearchResponse {
  data?: {
    domain?: string;
    pattern?: string | null;
    emails?: HunterEmailEntry[];
  };
  errors?: { id?: string; code?: number; details?: string }[];
}

/** Pick the best email from Hunter's response for a given first + last.
 *  Priority:
 *    1. Exact first + last match
 *    2. Last-name-only match (common when the company has one employee)
 *    3. First-name-only match
 *  Confidence is Hunter's own 0-100 score, normalized to 0-1. */
function bestEmailMatch(
  emails: HunterEmailEntry[],
  firstName: string | null,
  lastName: string | null,
): { entry: HunterEmailEntry; confidence: number } | null {
  if (!emails.length) return null;

  const first = (firstName ?? "").toLowerCase().trim();
  const last = (lastName ?? "").toLowerCase().trim();

  // Tier 1 — exact first + last match
  if (first && last) {
    const match = emails.find(
      (e) =>
        (e.first_name ?? "").toLowerCase().trim() === first &&
        (e.last_name ?? "").toLowerCase().trim() === last,
    );
    if (match) {
      return {
        entry: match,
        confidence: Math.max(0, Math.min(1, (match.confidence ?? 50) / 100)),
      };
    }
  }

  // Tier 2 — last-name-only match
  if (last) {
    const match = emails.find(
      (e) => (e.last_name ?? "").toLowerCase().trim() === last,
    );
    if (match) {
      return {
        entry: match,
        confidence: Math.max(0, Math.min(0.8, (match.confidence ?? 40) / 100)),
      };
    }
  }

  // Tier 3 — first-name-only match
  if (first) {
    const match = emails.find(
      (e) => (e.first_name ?? "").toLowerCase().trim() === first,
    );
    if (match) {
      return {
        entry: match,
        confidence: Math.max(0, Math.min(0.6, (match.confidence ?? 30) / 100)),
      };
    }
  }

  return null;
}

/**
 * Try to discover an email via Hunter.io's domain-search API. Returns null
 * on any failure (unset key, rate limit, unparseable domain, zero hits).
 *
 * @param businessName  e.g. "Smith Plumbing LLC"
 * @param firstName     Parsed first name (may be null)
 * @param lastName      Parsed last name (may be null)
 */
export async function inferEmailFromBusinessName(
  businessName: string,
  firstName: string | null,
  lastName: string | null,
): Promise<EmailInferenceResult | null> {
  // No-op when the API key isn't set — keeps dev + CI environments clean.
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;

  // Previously rate-limited in this lambda — don't keep hammering the API.
  if (rateLimitTripped) return null;

  const domain = domainFromBusinessName(businessName);
  if (!domain) return null;

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(
    domain,
  )}&limit=3&api_key=${encodeURIComponent(apiKey)}`;

  // 10s timeout — Hunter is usually sub-second but we don't want a
  // hung TCP connection to eat the whole cron budget.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    // 429 = monthly quota hit; 403 = often thrown on free-tier exhaustion
    // or blocked key. Either way, stop trying for the rest of this run.
    if (res.status === 429 || res.status === 403) {
      rateLimitTripped = true;
      logger.warn("hunter-email: rate limit / quota tripped — skipping rest of run", {
        status: res.status,
        domain,
      });
      return null;
    }

    if (!res.ok) {
      // Non-critical — soft fail. 404 on unknown domain is the common case.
      return null;
    }

    const json = (await res.json()) as HunterDomainSearchResponse;
    const emails = json.data?.emails ?? [];
    const pattern = json.data?.pattern ?? null;

    if (!emails.length) return null;

    const picked = bestEmailMatch(emails, firstName, lastName);
    if (!picked) return null;

    return {
      email: picked.entry.value,
      confidence: picked.confidence,
      pattern,
    };
  } catch (err) {
    // Abort / network error / JSON parse error — all soft fail.
    logger.debug("hunter-email: lookup failed", {
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
