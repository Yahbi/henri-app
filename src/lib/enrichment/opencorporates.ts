/**
 * OpenCorporates LLC → Principal Lookup
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a contractor business name (from a permit's
 * `contractor_name` / `applicant_name` column) that looks like an LLC,
 * look up the registered company on OpenCorporates, extract its officer
 * list, and surface the most likely principal.
 *
 * This complements `scripts/correlate-enrichment.ts` Pass 4 (which
 * derives contractor → principal from repeated-appearance patterns in
 * our own permits table). When our local correlation can't find a
 * dominant principal, OpenCorporates often can — they've scraped
 * every US Secretary of State's business registry and unified the
 * records into a queryable API.
 *
 * ## Free tier
 *
 *   - 500 requests per day, shared across all endpoints
 *   - Requires registration at https://opencorporates.com/api_accounts/new
 *   - API key passed via `?api_token=...` query param
 *   - Per-second rate limit unclear; we conservatively pace at 1 req/s
 *     to avoid tripping their daily bucket faster than needed
 *
 * Gating: this module is a no-op unless `OPENCORPORATES_API_KEY` is set.
 * When disabled, every call returns null without touching the network —
 * zero-risk default so /api/cron/enrich can call it unconditionally.
 *
 * ## Match strategy (cost-conscious, free tier is precious)
 *
 * We search by exact company name + jurisdiction (state). OpenCorporates
 * ranks results by match quality; we take the first result and fetch
 * its officer list in a second call. Two API calls per match. That
 * means the free-tier 500/day budget supports ~250 successful enrichments
 * per day — more than enough for new-lead throughput (ingest cron finds
 * maybe 100-300 new permits/run across all 25 sources).
 *
 * ## Failure modes (all return null, no throw)
 *
 *   - Missing `OPENCORPORATES_API_KEY` — module disabled
 *   - Business name isn't parseable as an LLC (e.g. "John Smith" — a
 *     person, not a company) — we detect via a shape heuristic
 *   - 429 rate-limited — trip a process-lifetime flag so the rest of
 *     this lambda invocation returns null without further API calls
 *   - 403 / 404 — company not found; return null
 *   - Network / timeout — silent null
 *
 * API docs: https://api.opencorporates.com/documentation/API-Reference
 */

import { logger } from "@/lib/logger";

const OPENCORPORATES_BASE = "https://api.opencorporates.com/v0.4";
const REQUEST_TIMEOUT_MS = 8_000;

/** Set to true when OpenCorporates returns 429 in this lambda lifetime.
 *  Prevents wasting further daily-budget slots on a bucket we know is
 *  exhausted. Resets on lambda cold start. */
let rateLimitTripped = false;

export interface OpenCorporatesResult {
  owner_name: string | null;        // best-guess principal
  owner_first: string | null;
  owner_last: string | null;
  officer_role: string | null;      // e.g. "manager", "member", "ceo"
  company_jurisdiction: string | null; // e.g. "us_ca"
  company_number: string | null;    // state registration id
  source: "opencorporates";
  confidence: number;               // 0..1
}

/** Shape heuristic — only query OpenCorporates when the business name
 *  actually looks like a company. "John Smith" is a person; no point
 *  burning the daily budget on it. */
function looksLikeCompany(businessName: string): boolean {
  const n = businessName.trim().toLowerCase();
  if (!n || n.length < 3) return false;
  // Strong positives: legal suffixes. These are the easy wins — the
  // business-name-parser already recognises them as company markers.
  const suffixes = [
    /\bllc\b/, /\bl\.l\.c\.?/, /\binc\b/, /\binc\.?$/,
    /\bcorp\b/, /\bco\b/, /\bcompany\b/, /\blp\b/, /\bplc\b/,
    /\blimited\b/, /\bpllc\b/, /\bpc\b/, /\btrust\b/,
  ];
  if (suffixes.some((r) => r.test(n))) return true;
  // Multi-word + no comma + no "and" (= not a couple's name) is a
  // weaker positive; accept it to avoid missing real companies that
  // just didn't spell out LLC in our ingested record.
  const hasComma = /,/.test(n);
  const hasAndAmp = /\b(and|&)\b/.test(n);
  const wordCount = n.split(/\s+/).length;
  return !hasComma && !hasAndAmp && wordCount >= 2 && wordCount <= 6;
}

/** Normalize "LLC" / "L.L.C." / "INC." into canonical form so we
 *  don't search for the same company three times. OpenCorporates
 *  handles most variants internally, but this makes our caches hit. */
function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/\b(L\.L\.C\.|L\.L\.C)\b/g, "LLC")
    .replace(/\bINC\.?$/g, "INC")
    .replace(/\bCORP\.?$/g, "CORP")
    .replace(/\s+/g, " ");
}

interface CompaniesSearchResponse {
  results?: {
    companies?: Array<{
      company: {
        name: string;
        company_number: string;
        jurisdiction_code: string;
        inactive: boolean;
      };
    }>;
  };
  error?: { code?: number; message?: string };
}

interface CompanyDetailResponse {
  results?: {
    company?: {
      name: string;
      jurisdiction_code: string;
      company_number: string;
      officers?: Array<{
        officer: {
          name: string;
          position?: string | null;
          inactive?: boolean;
          end_date?: string | null;
        };
      }>;
    };
  };
  error?: { code?: number; message?: string };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri Lead-Gen Platform (enrichment)",
      },
    });
    clearTimeout(timer);
    if (res.status === 429) {
      rateLimitTripped = true;
      logger.warn("opencorporates: 429 daily quota exhausted");
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("opencorporates fetch failed", {
        url: url.replace(/api_token=[^&]+/, "api_token=<redacted>"),
        error: (e as Error).message,
      });
    }
    return null;
  }
}

/** Split "Smith, John J" or "John Smith" into first/last. Same split
 *  heuristic as the rest of the enrichment stack uses; kept local so
 *  this file is self-contained. */
function splitName(full: string): { first: string | null; last: string | null } {
  const trimmed = full.trim();
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",").map((s) => s.trim());
    return { first: first || null, last: last || null };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return { first: parts[0], last: parts.slice(1).join(" ") };
  return { first: null, last: trimmed };
}

/**
 * Look up a contractor business on OpenCorporates and return the most
 * likely principal. Returns null for any failure mode — never throws.
 *
 * @param businessName  The contractor/applicant name from permits,
 *                      e.g. "Smith Plumbing LLC".
 * @param stateCode     2-letter US state code (optional). Narrows the
 *                      jurisdiction search to one state — cheaper and
 *                      more accurate than hitting all 50.
 */
export async function lookupCompanyPrincipal(
  businessName: string,
  stateCode?: string | null,
): Promise<OpenCorporatesResult | null> {
  const apiKey = process.env.OPENCORPORATES_API_KEY;
  if (!apiKey) return null;
  if (rateLimitTripped) return null;

  const trimmed = businessName?.trim();
  if (!trimmed || !looksLikeCompany(trimmed)) return null;

  const normalized = normalizeCompanyName(trimmed);

  // Build jurisdiction filter. OpenCorporates uses `us_ca` / `us_ny` etc.
  // If no state, we omit the filter and accept wider matches.
  const jurisdictionParam =
    stateCode && /^[A-Z]{2}$/i.test(stateCode)
      ? `&jurisdiction_code=us_${stateCode.toLowerCase()}`
      : "";

  // Step 1: company search. Order results by score so the best match
  // is first. `inactive=false` skips dissolved LLCs.
  const searchUrl = `${OPENCORPORATES_BASE}/companies/search?q=${encodeURIComponent(
    normalized,
  )}${jurisdictionParam}&inactive=false&order=score&per_page=1&api_token=${encodeURIComponent(
    apiKey,
  )}`;

  const search = await fetchJson<CompaniesSearchResponse>(searchUrl);
  const match = search?.results?.companies?.[0]?.company;
  if (!match) return null;

  // Step 2: fetch company detail with officers. The search result only
  // returns the company metadata; officers need a second call.
  const detailUrl = `${OPENCORPORATES_BASE}/companies/${encodeURIComponent(
    match.jurisdiction_code,
  )}/${encodeURIComponent(
    match.company_number,
  )}?api_token=${encodeURIComponent(apiKey)}`;

  const detail = await fetchJson<CompanyDetailResponse>(detailUrl);
  const officers = detail?.results?.company?.officers ?? [];
  if (officers.length === 0) return null;

  // Prefer active officers with a member/manager/ceo/president role.
  // Fall back to the first active officer. Avoid dissolved / inactive.
  const scoreRole = (pos: string | null | undefined): number => {
    if (!pos) return 1;
    const p = pos.toLowerCase();
    if (/member|manager|managing.member|owner|principal/.test(p)) return 5;
    if (/ceo|president|director|officer/.test(p)) return 4;
    if (/secretary|treasurer/.test(p)) return 3;
    if (/registered.agent/.test(p)) return 2;
    return 1;
  };

  const active = officers.filter((o) => !o.officer.inactive && !o.officer.end_date);
  const pool = active.length > 0 ? active : officers;
  pool.sort((a, b) => scoreRole(b.officer.position) - scoreRole(a.officer.position));
  const primary = pool[0]?.officer;
  if (!primary?.name) return null;

  const { first, last } = splitName(primary.name);

  // Confidence heuristic:
  //  - Active officer with a strong role: 0.8
  //  - Active officer, generic role: 0.6
  //  - Only inactive officers available: 0.4
  const confidence = !primary.inactive
    ? scoreRole(primary.position) >= 4
      ? 0.8
      : 0.6
    : 0.4;

  return {
    owner_name: primary.name.trim(),
    owner_first: first,
    owner_last: last,
    officer_role: primary.position ?? null,
    company_jurisdiction: match.jurisdiction_code,
    company_number: match.company_number,
    source: "opencorporates",
    confidence,
  };
}
