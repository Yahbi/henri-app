/**
 * Voter Registration Lookup (SCAFFOLD — NOT LIVE)
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: free phone-recovery by looking up voter registration records. A
 * small number of US states publish the voter roll with phone numbers and
 * allow public / non-commercial requests. For the homeowners we care about,
 * matching a permit applicant's address (and optionally last name) against
 * the state voter file can surface a phone number where county GIS / tax
 * data gives us only a name.
 *
 * Why this file is a scaffold, not a working integration:
 *
 *   - Voter-roll APIs are unstable and legally fraught. Almost no state
 *     publishes an OFFICIAL HTTPS API for the voter file — most require a
 *     signed request, a stated public-interest use, and a nominal fee, and
 *     the file itself is a CSV you ingest once, not a live lookup.
 *
 *   - Use restrictions vary wildly per state. California publishes the
 *     voter file to qualified requesters only, with strict non-commercial
 *     use rules. Texas lets you obtain the voter file for a fee but does
 *     NOT include phone numbers. Florida publishes phone + email but caps
 *     commercial use. Treating any of these as a casual `fetch()` would
 *     put the company out of compliance on day one.
 *
 *   - Vendor selection is still open. The realistic production path is a
 *     compliance-vetted data aggregator (TargetSmart, L2, Aristotle, etc.)
 *     that handles the 50-state file + phone append + legal agreements. We
 *     have not picked one yet. When we do, this module is where the call
 *     lands.
 *
 * Until then: this module exists so the cron code path that would consume
 * it can be written, reviewed, and tested end-to-end. It returns `null`
 * for every call by default and makes ZERO network requests — zero-risk
 * compliance. A future implementer flips `VOTER_REG_ENABLED=1`, picks the
 * vendor, and replaces the stub warning with the real lookup.
 *
 * Allowlist today: California only (highest lead density + public voter
 * file with non-commercial research exception). Texas is intentionally
 * excluded even at the address-match level until a legal review approves
 * the use case. No other states until a vendor contract is in place.
 *
 * Expected sources once live:
 *   - "voter_reg_ca"  — CA Secretary of State voter file (requester-only)
 *   - future: "voter_reg_vendor_l2" etc. when a paid aggregator is wired.
 */

import { logger } from "@/lib/logger";

export interface VoterLookupResult {
  phone: string | null;
  owner_name: string | null;
  source: string; // "voter_reg_ca" etc.
  confidence: number; // 0..1 — how sure we are this row matches the address
}

/** States we'd attempt a live lookup against once the integration is live.
 *  Currently only CA — all others fall through to null until a vendor is
 *  in place AND the compliance review clears that state. */
const LIVE_ALLOWLIST = new Set<string>(["CA"]);

/**
 * Look up a voter registration record by address. Gated behind the
 * `VOTER_REG_ENABLED=1` env var so the integration cannot accidentally
 * make network requests before a vendor / compliance path is picked.
 *
 * @param state     2-letter US state code ("CA", "TX", …). Required.
 * @param address   Street address as stored on the permit / lead.
 * @param zip       5-digit ZIP (optional — improves match precision).
 * @param lastName  Optional — if we already have a parsed surname from the
 *                  permit, passing it collapses the common "Smith at 123
 *                  Main" ambiguity.
 *
 * @returns VoterLookupResult with phone + owner_name, or null when the
 *          module is disabled / state is out of allowlist / live path
 *          isn't implemented yet.
 */
export async function lookupVoterByAddress(
  state: string,
  address: string,
  zip: string | null,
  lastName?: string,
): Promise<VoterLookupResult | null> {
  // Graceful no-op: module is disabled by default.
  if (process.env.VOTER_REG_ENABLED !== "1") {
    return null;
  }

  // State allowlist: only hit states we've cleared for live lookup.
  const stateCode = (state ?? "").toUpperCase().trim();
  if (!stateCode || !LIVE_ALLOWLIST.has(stateCode)) {
    return null;
  }

  // Defensive: require the minimum inputs a real lookup would need.
  const trimmedAddress = (address ?? "").trim();
  if (!trimmedAddress) return null;

  // Live path not yet implemented — warn once (not on every call, but
  // simple logger.warn is fine; this branch only runs when the operator
  // explicitly flipped the env flag) and return null so the caller keeps
  // going without a phone.
  logger.warn(
    "voter-registration.ts: live lookup not implemented — pending vendor selection",
    {
      state: stateCode,
      zip: zip ?? null,
      has_last_name: Boolean(lastName),
    },
  );

  return null;
}
