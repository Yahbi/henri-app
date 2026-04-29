/**
 * Paycheck Protection Program (PPP) Loan Lookup
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves a business name + address against the local `ppp_loans` table
 * populated by `scripts/ingest-ppp.ts`. The SBA's bulk PPP dataset carries:
 *
 *   - Business name + DBA (BorrowerName)
 *   - Business address + ZIP
 *   - NAICS industry code
 *   - Employee count (JobsReported)
 *   - Loan amount + forgiveness status
 *   - Owner first / last name (≥$150k pre-redaction release only)
 *   - Business phone (≥$150k pre-redaction release only)
 *
 * Two primary query modes:
 *   1. By business name — exact or ILIKE match on `lower(borrower_name)`,
 *      optionally scoped by state. The ppp_loans_borrower_name_idx backs
 *      exact-lower lookups; prefix ILIKE falls through to a seq-scan which
 *      is tolerable since state scope dramatically reduces the working set.
 *   2. By address — exact ZIP + address ILIKE prefix. Matches the
 *      (borrower_zip, lower(borrower_address)) index with a range scan.
 *
 * When both are provided we try name first (higher confidence hit), and
 * fall back to address if name produced nothing.
 *
 * Never throws. Returns null when:
 *   - No usable lookup input (all four args empty / falsy)
 *   - Migration 00042 isn't applied yet (table missing)
 *   - Admin-client init fails (bad env)
 *   - Query errors for any reason (network, RLS, etc.)
 *   - No matching row found
 *
 * Uses the service-role admin client — `ppp_loans` has RLS enabled with
 * no permissive policy, so the anon/authenticated paths return nothing.
 * Enrichment is a server-side cron concern; the browser should never
 * touch this directly.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface PPPLookupArgs {
  /** Exact business name from the permit's contractor_name / applicant_name.
   *  Case-insensitive matching; the lookup normalizes internally. */
  businessName?: string | null;
  /** Street address — matched with ILIKE prefix against the normalized
   *  column. Useful when we don't have a business name, just an address
   *  that happens to be a registered business. */
  address?: string | null;
  /** 5-digit ZIP. Dramatically reduces the working set for address lookups;
   *  also narrows name lookups when multiple LLCs share a name across states. */
  zip?: string | null;
  /** 2-letter state code. Optional scope for name lookups. */
  stateCode?: string | null;
}

export interface PPPLookupResult {
  owner_name: string | null;
  owner_first: string | null;
  owner_last: string | null;
  business_name: string;
  business_phone: string | null;
  business_address: string;
  naics_code: string | null;
  employee_count: number | null;
  loan_amount: number | null;
  source: "ppp_sba";
  confidence: number;
}

/* ── Internal helpers ────────────────────────────────────────────────── */

function normalizeAddress(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function strip5Zip(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const m = t.match(/^(\d{5})/);
  return m ? m[1]! : t.slice(0, 5);
}

/** Escape the % / _ / \ chars that Postgres interprets inside a LIKE
 *  pattern. Business names in permits occasionally contain %, and we
 *  don't want to turn those into wildcards. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

interface PPPRow {
  borrower_name: string | null;
  borrower_address: string | null;
  borrower_city: string | null;
  borrower_state: string | null;
  borrower_zip: string | null;
  naics_code: string | null;
  owner_first: string | null;
  owner_last: string | null;
  business_phone: string | null;
  employee_count: number | null;
  loan_amount: number | null;
}

/**
 * Build a compact human-readable address string for the returned result.
 * The lookup module's contract guarantees `business_address` is a string
 * (never null), so fall back to the zip/city when the street is missing.
 */
function composeAddress(row: PPPRow): string {
  const street = (row.borrower_address ?? "").trim();
  const city = (row.borrower_city ?? "").trim();
  const st = (row.borrower_state ?? "").trim();
  const zip = (row.borrower_zip ?? "").trim();
  const cityStZip = [city, st].filter(Boolean).join(", ");
  const tail = [cityStZip, zip].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ");
}

function composeOwnerName(row: PPPRow): string | null {
  const f = (row.owner_first ?? "").trim();
  const l = (row.owner_last ?? "").trim();
  const joined = [f, l].filter(Boolean).join(" ");
  return joined ? joined : null;
}

function toResult(row: PPPRow, confidence: number): PPPLookupResult {
  return {
    owner_name: composeOwnerName(row),
    owner_first: (row.owner_first ?? "").trim() || null,
    owner_last: (row.owner_last ?? "").trim() || null,
    business_name: (row.borrower_name ?? "").trim(),
    business_phone: (row.business_phone ?? "").trim() || null,
    business_address: composeAddress(row),
    naics_code: (row.naics_code ?? "").trim() || null,
    employee_count: row.employee_count ?? null,
    loan_amount: row.loan_amount ?? null,
    source: "ppp_sba",
    confidence,
  };
}

const SELECT_COLS =
  "borrower_name, borrower_address, borrower_city, borrower_state, borrower_zip, naics_code, owner_first, owner_last, business_phone, employee_count, loan_amount";

/** Common RLS-aware table-missing check. The anon/authenticated roles
 *  can't read ppp_loans at all (default-deny RLS), but the service-role
 *  bypasses that — so a query error here really does mean the table
 *  doesn't exist yet. Log once per process so the operator sees it. */
function isMissingTable(message: string): boolean {
  return /does not exist|relation .* does not exist/i.test(message);
}

/* ── Query modes ─────────────────────────────────────────────────────── */

// `SupabaseLike` removed 2026-04-24 — was a structural type used by an
// earlier query-helper draft that never shipped. The actual helpers
// below take `ReturnType<typeof createAdminClient>` which is sufficient.

async function queryByName(
  client: ReturnType<typeof createAdminClient>,
  businessName: string,
  stateCode: string | null,
): Promise<{ row: PPPRow | null; tableMissing: boolean }> {
  const normalized = businessName.trim().toLowerCase();
  if (!normalized) return { row: null, tableMissing: false };

  // Step 1: exact lower-case match (hits the ppp_loans_borrower_name_idx).
  let query = client
    .from("ppp_loans")
    .select(SELECT_COLS)
    .ilike("borrower_name", normalized);
  if (stateCode) query = query.eq("borrower_state", stateCode);

  const exact = await (query.limit(1) as unknown as Promise<{
    data: PPPRow[] | null;
    error: { message?: string } | null;
  }>);

  if (exact.error) {
    const msg = exact.error.message ?? "";
    if (isMissingTable(msg)) return { row: null, tableMissing: true };
    logger.warn("ppp-loan.queryByName: exact lookup failed", { error: msg });
    return { row: null, tableMissing: false };
  }
  if (exact.data && exact.data.length > 0) {
    return { row: exact.data[0] ?? null, tableMissing: false };
  }

  // Step 2: fuzzy prefix ILIKE (slower, no index — bounded by the rarer
  // optional state filter).
  const prefix = `${escapeLike(normalized)}%`;
  let fuzzyQuery = client
    .from("ppp_loans")
    .select(SELECT_COLS)
    .ilike("borrower_name", prefix);
  if (stateCode) fuzzyQuery = fuzzyQuery.eq("borrower_state", stateCode);

  const fuzzy = await (fuzzyQuery.limit(1) as unknown as Promise<{
    data: PPPRow[] | null;
    error: { message?: string } | null;
  }>);

  if (fuzzy.error) {
    logger.warn("ppp-loan.queryByName: fuzzy lookup failed", {
      error: fuzzy.error.message,
    });
    return { row: null, tableMissing: false };
  }
  if (fuzzy.data && fuzzy.data.length > 0) {
    return { row: fuzzy.data[0] ?? null, tableMissing: false };
  }

  return { row: null, tableMissing: false };
}

async function queryByAddress(
  client: ReturnType<typeof createAdminClient>,
  address: string,
  zip: string,
): Promise<{ row: PPPRow | null; tableMissing: boolean }> {
  const normalized = normalizeAddress(address);
  const zip5 = strip5Zip(zip);
  if (!normalized || !zip5) return { row: null, tableMissing: false };

  // Prefix ILIKE against the normalized column; the
  // (borrower_zip, lower(borrower_address)) index supports the range scan.
  const prefix = `${escapeLike(normalized)}%`;
  const query = client
    .from("ppp_loans")
    .select(SELECT_COLS)
    .eq("borrower_zip", zip5)
    .ilike("borrower_address", prefix);

  const res = await (query.limit(1) as unknown as Promise<{
    data: PPPRow[] | null;
    error: { message?: string } | null;
  }>);

  if (res.error) {
    const msg = res.error.message ?? "";
    if (isMissingTable(msg)) return { row: null, tableMissing: true };
    logger.warn("ppp-loan.queryByAddress: lookup failed", { error: msg });
    return { row: null, tableMissing: false };
  }
  if (res.data && res.data.length > 0) {
    return { row: res.data[0] ?? null, tableMissing: false };
  }
  return { row: null, tableMissing: false };
}

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Look up a PPP record. Tries business name first (higher confidence)
 * when provided; falls back to address + zip. Always returns null on
 * any failure path so callers don't need branches for error handling.
 *
 * Confidence tiers:
 *   0.9 — exact business-name + state match
 *   0.8 — address + zip match (no business name supplied, or name missed)
 *   0.6 — fuzzy name match (prefix ILIKE, no state scope needed)
 */
export async function lookupPPP(
  args: PPPLookupArgs,
): Promise<PPPLookupResult | null> {
  const businessName = (args.businessName ?? "").trim();
  const address = (args.address ?? "").trim();
  const zip = (args.zip ?? "").trim();
  const stateCode = (args.stateCode ?? "").trim().toUpperCase() || null;

  // Nothing to query on → null immediately.
  if (!businessName && !(address && zip)) return null;

  let client: ReturnType<typeof createAdminClient>;
  try {
    client = createAdminClient();
  } catch (err) {
    logger.warn("ppp-loan.lookupPPP: admin client init failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  try {
    // ── Mode 1: business name first (exact → fuzzy) ─────────────────
    if (businessName) {
      const nameResult = await queryByName(client, businessName, stateCode);
      if (nameResult.tableMissing) {
        logger.warn(
          "ppp-loan.lookupPPP: ppp_loans missing (run migration 00042)",
        );
        return null;
      }
      if (nameResult.row) {
        // Exact match when both name AND state lined up → 0.9.
        // The exact-path query filters by state when stateCode is set,
        // so a hit there means state matched. A prefix-fuzzy match
        // drops to 0.6. We distinguish by re-checking the returned row.
        const rowStateMatches =
          stateCode &&
          (nameResult.row.borrower_state ?? "").trim().toUpperCase() === stateCode;
        const rowNameExact =
          (nameResult.row.borrower_name ?? "").trim().toLowerCase() ===
          businessName.toLowerCase();

        let confidence: number;
        if (rowNameExact && (rowStateMatches || !stateCode)) {
          confidence = 0.9;
        } else if (rowNameExact) {
          confidence = 0.8;
        } else {
          confidence = 0.6;
        }
        return toResult(nameResult.row, confidence);
      }
      // Name didn't hit → fall through to address if we have one.
    }

    // ── Mode 2: address fallback ────────────────────────────────────
    if (address && zip) {
      const addrResult = await queryByAddress(client, address, zip);
      if (addrResult.tableMissing) {
        logger.warn(
          "ppp-loan.lookupPPP: ppp_loans missing (run migration 00042)",
        );
        return null;
      }
      if (addrResult.row) {
        return toResult(addrResult.row, 0.8);
      }
    }

    return null;
  } catch (err) {
    logger.warn("ppp-loan.lookupPPP: unexpected throw", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
