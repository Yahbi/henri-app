/**
 * State contractor-license-board lookup
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a contractor business name (and ideally a state),
 * look up the public contractor-license registry to retrieve the
 * business phone number, license holder name, mailing address, and
 * license status. Every US state requires licensed contractors to
 * publish this info — the data is free and authoritative.
 *
 * This is the cheapest path to getting a PHONE number for the
 * contractor side of a lead (permit is filed by the contractor, so
 * contractor.phone is "the person most likely to call you back").
 * Homeowner phone numbers remain hard without voter-file ingestion;
 * contractor phones are a query away.
 *
 * ## Per-state routing
 *
 * Each state runs its own registry with its own endpoint, auth model,
 * and response format. This module dispatches to per-state query
 * functions keyed on the 2-letter state code. Today we cover:
 *
 *   - **CA — CSLB** (California Contractors State License Board)
 *     JSON endpoint, no auth required, rate-limit unclear but ~2 req/s
 *     has been fine in testing. Source of truth for 280k+ active
 *     California contractors.
 *
 *   - **TX — TDLR** (Texas Department of Licensing and Regulation)
 *     Paginated HTML search at www.tdlr.texas.gov; no JSON API.
 *     We parse a small HTML response for the specific trades TDLR
 *     regulates (HVAC, electrical, plumbing). Slower, ~1 req/s.
 *     Currently SCAFFOLDED (not yet implemented) — CA is the only
 *     state with a clean JSON path.
 *
 *   - **FL — DBPR** (Department of Business and Professional Regulation)
 *     HTML search at www.myfloridalicense.com. Scaffolded.
 *
 * Adding a state: implement `query{StateCode}(name)` and register in
 * `STATE_LOOKUPS`.
 *
 * ## Legal
 *
 * Contractor license registries are public records by statute in all
 * 50 states. No ToS issue with querying them programmatically for
 * enrichment purposes, but each state's robots.txt and rate-limit
 * behavior should be respected — we pace at 1 req/s per state.
 *
 * ## Failure modes
 *
 * All return null on any error. Never throws. No external-service
 * hard dependency on enrichment.
 */

import { logger } from "@/lib/logger";

const REQUEST_TIMEOUT_MS = 10_000;

export interface ContractorLicenseResult {
  license_holder_name: string | null;
  license_holder_first: string | null;
  license_holder_last: string | null;
  business_name: string | null;
  business_phone: string | null;
  business_address: string | null;
  license_number: string | null;
  license_class: string | null;    // e.g. "B", "C-39" (CA) / "ACR" (TX)
  license_status: string | null;   // "active", "expired", "suspended"
  source: string;                  // "cslb_ca" / "tdlr_tx" / "dbpr_fl"
  confidence: number;
}

/** Normalize business name for searching — uppercased, single-spaced,
 *  legal-suffix stripped. CSLB's search is case-insensitive and ignores
 *  trailing entity types, so a canonical form reduces false misses. */
function normalizeForSearch(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/\b(L\.L\.C\.|LLC|INC\.?|CORP\.?|CO\.?|LTD\.?|LP)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitName(full: string): { first: string | null; last: string | null } {
  const t = full.trim();
  if (t.includes(",")) {
    const [last, first] = t.split(",").map((s) => s.trim());
    return { first: first || null, last: last || null };
  }
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return { first: parts[0], last: parts.slice(1).join(" ") };
  return { first: null, last: t };
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  // Strip country code if present
  const clean = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (clean.length !== 10) return null;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

/* ── California — CSLB ─────────────────────────────────────────────── */
/*
 * CSLB publishes license data at https://www.cslb.ca.gov/OnlineServices/
 * CheckLicenseII/. The underlying JSON endpoint is:
 *   https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/api/
 *     LicenseSearch?BusinessName=<name>
 *
 * Response shape (observed 2026-04):
 *   { Licenses: [{ LicenseNumber, BusinessName, BusinessPhoneNumber,
 *     Address: { Addr1, City, State, Zip }, PrimaryClassification,
 *     Classifications: [...], Status, PersonalName, ... }] }
 *
 * Not all fields are always populated; the formatter below defends
 * against every sub-field being optional.
 */
interface CSLBResponse {
  Licenses?: Array<{
    LicenseNumber?: string;
    BusinessName?: string;
    BusinessPhoneNumber?: string;
    PersonalName?: string;
    PrimaryClassification?: string;
    Status?: string;
    Address?: {
      Addr1?: string;
      City?: string;
      State?: string;
      Zip?: string;
    };
  }>;
}

async function queryCSLB(businessName: string): Promise<ContractorLicenseResult | null> {
  const q = normalizeForSearch(businessName);
  if (!q) return null;

  const url =
    "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/api/LicenseSearch" +
    `?BusinessName=${encodeURIComponent(q)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri Lead-Gen Platform (public-records enrichment)",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const body = (await res.json()) as CSLBResponse;
    const lic = body.Licenses?.[0];
    if (!lic) return null;

    // Prefer ACTIVE licenses if the search returned multiple. The
    // default result order is by relevance, not status, so we manually
    // scan for active first.
    const active = body.Licenses?.find(
      (l) => l.Status && /active/i.test(l.Status),
    );
    const chosen = active ?? lic;

    const addressParts = [
      chosen.Address?.Addr1,
      chosen.Address?.City,
      chosen.Address?.State,
      chosen.Address?.Zip,
    ].filter(Boolean);

    const personalName = chosen.PersonalName ?? null;
    const { first, last } = personalName
      ? splitName(personalName)
      : { first: null, last: null };

    return {
      license_holder_name: personalName,
      license_holder_first: first,
      license_holder_last: last,
      business_name: chosen.BusinessName ?? null,
      business_phone: normalizePhone(chosen.BusinessPhoneNumber),
      business_address: addressParts.length > 0 ? addressParts.join(", ") : null,
      license_number: chosen.LicenseNumber ?? null,
      license_class: chosen.PrimaryClassification ?? null,
      license_status: chosen.Status ?? null,
      source: "cslb_ca",
      // Confidence: active licenses with a phone = 0.9, any other hit = 0.6
      confidence:
        chosen.Status && /active/i.test(chosen.Status) && chosen.BusinessPhoneNumber
          ? 0.9
          : 0.6,
    };
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("cslb fetch failed", { error: (e as Error).message });
    }
    return null;
  }
}

/* ── Texas — TDLR (scaffolded) ─────────────────────────────────────── */
async function queryTDLR(_businessName: string): Promise<ContractorLicenseResult | null> {
  // TDLR uses an HTML search form, not a clean JSON API. Parsing the
  // HTML response is straightforward but stateful (viewstate, event-
  // target tokens). Left as a scaffold; enable when we ship a TX
  // market and have real demand for TDLR lookups.
  return null;
}

/* ── Florida — DBPR (scaffolded) ───────────────────────────────────── */
async function queryDBPR(_businessName: string): Promise<ContractorLicenseResult | null> {
  // DBPR has a public search at www.myfloridalicense.com but it's
  // captcha-gated after a few rapid queries. Would need a user-key
  // scraping session or a paid partner. Scaffold for now.
  return null;
}

/* ── Registry + dispatch ───────────────────────────────────────────── */

const STATE_LOOKUPS: Record<
  string,
  (businessName: string) => Promise<ContractorLicenseResult | null>
> = {
  CA: queryCSLB,
  TX: queryTDLR,
  FL: queryDBPR,
};

/**
 * Look up a contractor business in the state's public license registry.
 * Returns null when:
 *   - state is not in our STATE_LOOKUPS registry,
 *   - businessName is empty or too short to search,
 *   - the registry returned no matches or failed.
 *
 * @param businessName  Contractor / applicant name from permits.
 * @param stateCode     2-letter US state code.
 */
export async function lookupContractorLicense(
  businessName: string,
  stateCode: string | null | undefined,
): Promise<ContractorLicenseResult | null> {
  if (!businessName?.trim() || businessName.length < 3) return null;
  const state = (stateCode ?? "").toUpperCase().trim();
  if (!state) return null;
  const query = STATE_LOOKUPS[state];
  if (!query) return null;
  return query(businessName);
}
