/**
 * FEC Contributor Lookup
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a parsed first + last name and a ZIP, query the FEC
 * individual-contribution endpoint for matches. Federal campaign finance
 * records (individual contributions $200+) include the contributor's
 * residence address, employer, and occupation — disclosure rules
 * require it. For the fraction of homeowners who donate, this is a
 * free, authoritative cross-reference for address + employer.
 *
 * ## What we get from a hit
 *
 *   - Confirmed residence address + ZIP (authoritative — contributor
 *     attestation under federal penalty-of-perjury)
 *   - Employer name (often matches a business the homeowner runs)
 *   - Occupation (free-form text, e.g. "Homemaker", "Software Engineer",
 *     "Contractor", "Plumber" — sometimes the occupation IS the trade
 *     we're scoring against)
 *   - Contribution pattern (recency, frequency) — a weak lifestyle
 *     signal that can feed into scoring but not exposed here
 *
 * ## Not what we get
 *
 *   - Email: not in FEC disclosures
 *   - Phone: not in FEC disclosures
 *
 * So this is primarily an owner-confirmation + employer-enrichment
 * source, NOT a phone/email source. Use it to cross-reference owners
 * we've already identified (from permits or voter files) and to pick
 * up employer info for scoring.
 *
 * ## Free tier
 *
 *   - API key via DATA.GOV signup: https://api.data.gov/signup/
 *   - 1,000 req/hour per key — plenty for enrichment
 *   - No daily cap explicitly documented
 *
 * Gating: no-op unless `FEC_API_KEY` is set.
 *
 * ## Why we still bother when this is narrow
 *
 * Empirically, ~30% of US adults have donated at some federal level in
 * the last decade. Selection bias: more likely to be politically-
 * engaged homeowners who own their home outright (i.e., the homeowner
 * segment most likely to pull a permit). So hit rate on our cohort is
 * likely higher than the population base rate — maybe 15-25%.
 *
 * API docs: https://api.open.fec.gov/developers
 */

import { logger } from "@/lib/logger";

const FEC_BASE = "https://api.open.fec.gov/v1";
const REQUEST_TIMEOUT_MS = 8_000;

let rateLimitTripped = false;

export interface FECContributorResult {
  owner_name: string | null;       // as recorded on FEC filings
  residence_address: string | null;
  residence_city: string | null;
  residence_state: string | null;
  residence_zip: string | null;
  employer: string | null;
  occupation: string | null;
  last_contribution_date: string | null;  // ISO
  total_contributions_2y: number | null;  // sum of last 2 election cycles
  source: "fec";
  confidence: number;
}

interface FECSchedAResponse {
  results?: Array<{
    contributor_name?: string;
    contributor_street_1?: string;
    contributor_city?: string;
    contributor_state?: string;
    contributor_zip?: string;
    contributor_employer?: string;
    contributor_occupation?: string;
    contribution_receipt_amount?: number;
    contribution_receipt_date?: string;
  }>;
  pagination?: { count?: number };
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
      logger.warn("fec: 429 hourly quota exhausted");
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("fec fetch failed", {
        url: url.replace(/api_key=[^&]+/, "api_key=<redacted>"),
        error: (e as Error).message,
      });
    }
    return null;
  }
}

/**
 * Look up contribution records for a person. Returns the most-recent
 * record's contributor info — which is the authoritative residence
 * address at the time of that contribution.
 *
 * @param firstName First name. Required — FEC's name search without a
 *                  first name returns too many false positives.
 * @param lastName  Last name. Required.
 * @param zip       5-digit ZIP. Helps disambiguate common names.
 * @param stateCode Optional 2-letter state code.
 */
export async function lookupFECContributor(params: {
  firstName: string;
  lastName: string;
  zip?: string | null;
  stateCode?: string | null;
}): Promise<FECContributorResult | null> {
  const apiKey = process.env.FEC_API_KEY;
  if (!apiKey) return null;
  if (rateLimitTripped) return null;

  const first = params.firstName?.trim();
  const last = params.lastName?.trim();
  if (!first || !last) return null;
  if (first.length < 2 || last.length < 2) return null;

  // FEC's individual-contributions endpoint: /schedules/schedule_a
  // Filter by contributor_name, contributor_zip (when provided),
  // contributor_state (when provided). Sort by
  // contribution_receipt_date DESC so the first result is the most
  // recent disclosure — most likely still accurate address-wise.
  //
  // Multi-cycle (2026-04-24 broadening): query the last 4 election
  // cycles (2018, 2020, 2022, 2024 — 8 years of history). FEC's
  // `two_year_transaction_period` param accepts multiple values when
  // repeated — each call pulls that cycle's records. Hitting all four
  // cycles is still ~4 API calls per person but gives us a much
  // richer employer/occupation history. Most donors appear in ≤2
  // cycles; the extra calls return ZERO_RESULTS cheaply.
  //
  // For the free-tier 1000/hr budget, 4 calls × ~50 enrichments/hr
  // = 200/hr → well within limits.
  const cycles = [2018, 2020, 2022, 2024] as const;
  const queriesPerCycle = cycles.map((cycle) => {
    const qParts = [
      `api_key=${encodeURIComponent(apiKey)}`,
      `contributor_name=${encodeURIComponent(`${last}, ${first}`)}`,
      `sort=-contribution_receipt_date`,
      `per_page=5`,
      `two_year_transaction_period=${cycle}`,
    ];
    if (params.zip && /^\d{5}$/.test(params.zip)) {
      qParts.push(`contributor_zip=${params.zip}`);
    }
    if (params.stateCode && /^[A-Z]{2}$/i.test(params.stateCode)) {
      qParts.push(`contributor_state=${params.stateCode.toUpperCase()}`);
    }
    return `${FEC_BASE}/schedules/schedule_a/?${qParts.join("&")}`;
  });

  // Fire all cycle queries in parallel, merge results by
  // contribution_receipt_date DESC so the aggregate array is still
  // sorted newest-first.
  const cycleResults = await Promise.all(
    queriesPerCycle.map((url) => fetchJson<FECSchedAResponse>(url)),
  );
  const allResults = cycleResults
    .flatMap((body) => body?.results ?? [])
    .sort((a, b) => {
      const da = a.contribution_receipt_date ?? "";
      const db = b.contribution_receipt_date ?? "";
      return db.localeCompare(da);
    });
  if (allResults.length === 0) return null;

  // Use the aggregated array as the `results` below. Keep the existing
  // downstream logic by shimming a fake response object.
  const body: FECSchedAResponse = { results: allResults };

  const results = body?.results ?? [];
  if (results.length === 0) return null;

  // Aggregate across the returned set: pick the most-recent record for
  // address/employer/occupation (those can change between filings),
  // but sum the contribution amounts for the last-2-years total.
  const mostRecent = results[0];
  if (!mostRecent) return null;

  const totalRecent = results
    .filter((r) => {
      const d = r.contribution_receipt_date;
      if (!d) return false;
      const dt = new Date(d);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      return dt >= twoYearsAgo;
    })
    .reduce((sum, r) => sum + (r.contribution_receipt_amount ?? 0), 0);

  // Confidence: higher when ZIP was part of the query (filtered to the
  // right area) AND the contributor_state matches what we passed.
  // Lower when we matched solely on name (common-name false-positive risk).
  let confidence = 0.6;
  if (params.zip && mostRecent.contributor_zip?.startsWith(params.zip)) {
    confidence = 0.85;
  }
  if (params.stateCode && mostRecent.contributor_state === params.stateCode.toUpperCase()) {
    confidence = Math.min(0.95, confidence + 0.1);
  }

  return {
    owner_name: mostRecent.contributor_name ?? `${first} ${last}`,
    residence_address: mostRecent.contributor_street_1 ?? null,
    residence_city: mostRecent.contributor_city ?? null,
    residence_state: mostRecent.contributor_state ?? null,
    // Strip +4 from the 9-digit zip format FEC sometimes returns
    residence_zip: mostRecent.contributor_zip?.slice(0, 5) ?? null,
    employer: mostRecent.contributor_employer ?? null,
    occupation: mostRecent.contributor_occupation ?? null,
    last_contribution_date: mostRecent.contribution_receipt_date ?? null,
    total_contributions_2y: totalRecent > 0 ? totalRecent : null,
    source: "fec",
    confidence,
  };
}
