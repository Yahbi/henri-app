import { STATE_LICENSE_CONFIGS } from "./states";

export interface VerificationResult {
  verified: boolean;
  status: "pending" | "verified" | "failed" | "expired" | "revoked";
  holder_name?: string;
  expiry_date?: string;
  license_type?: string;
  raw_response?: Record<string, unknown>;
  error?: string;
}

/**
 * Format-check a contractor license number and record it for review.
 *
 * IMPORTANT — this module does NOT contact any state licensing board.
 * Despite the name, no code path here makes an HTTP request: every
 * branch returns `pending` (or `failed` on a malformed number). The
 * only real cross-check Henri performs is the roster match at signup
 * (`/api/onboarding/verify-license` against `state_license_rosters`),
 * which covers the states we hold rosters for.
 *
 * This docstring is deliberately blunt because the previous version
 * ("Verify a contractor license against the appropriate state licensing
 * board... automated verification for California") read as if a live
 * board check existed, and that belief propagated into user-facing copy
 * across the marketing site, onboarding, compliance and the homeowner
 * contractor card — all of which promised homeowners that contractors
 * were "verified daily against the state board." None of it was true.
 *
 * If a real board integration is added later, update this docstring and
 * the copy that depends on it in the same commit.
 */
export async function verifyLicense(
  licenseNumber: string,
  state: string,
  _licenseType?: string
): Promise<VerificationResult> {
  const config = STATE_LICENSE_CONFIGS[state];

  if (!config) {
    return {
      verified: false,
      status: "pending",
      error: `License verification for ${state} is not yet configured. Marked for manual review.`,
    };
  }

  if (config.apiAvailable && state === "CA") {
    return verifyCalifornia(licenseNumber);
  }

  // For states without API access, mark as pending for manual review
  return {
    verified: false,
    status: "pending",
    raw_response: {
      state,
      board: config.board,
      lookup_url: config.lookupUrl,
      note: "Automated verification not available for this state. Marked for manual review.",
    },
  };
}

/**
 * California CSLB — FORMAT CHECK ONLY. Makes no request to CSLB.
 * Returns `pending` so the record is queued for review.
 */
async function verifyCalifornia(licenseNumber: string): Promise<VerificationResult> {
  // CSLB license numbers are typically 6-7 digits
  const cleaned = licenseNumber.replace(/\D/g, "");
  if (cleaned.length < 5 || cleaned.length > 8) {
    return {
      verified: false,
      status: "failed",
      error: "Invalid CSLB license number format. Expected 5-8 digits.",
    };
  }

  // `raw_response` is surfaced to the contractor in the onboarding and
  // compliance UIs, so its `note` must not promise work that no code
  // performs. The previous value — "Full CSLB verification will complete
  // within 24 hours." — described a board integration that does not
  // exist and a cron that only calls back into this same function.
  return {
    verified: false,
    status: "pending",
    raw_response: {
      state: "CA",
      board: "CSLB",
      license_number: cleaned,
      note: "License number format accepted. Not yet checked against CSLB records.",
    },
  };
}

/**
 * Re-check an existing license (called by /api/cron/license-check).
 *
 * Delegates to `verifyLicense`, which contacts no board — so this
 * CANNOT detect a license that was revoked or suspended after signup.
 * The only status change it can surface today is expiry, and that comes
 * from the `expiry_date` already stored on the row, not from upstream.
 *
 * Kept as a distinct export so the cron has a seam to swap in a real
 * board client without touching its call site.
 */
export async function recheckLicense(
  licenseNumber: string,
  state: string
): Promise<VerificationResult> {
  return verifyLicense(licenseNumber, state);
}
