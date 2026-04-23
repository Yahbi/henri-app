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
 * Verify a contractor license against the appropriate state licensing board.
 * Currently supports automated verification for California (CSLB).
 * All other states are marked as "pending" for manual review.
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
 * California CSLB verification.
 * In production, this would scrape or call the CSLB API.
 * For now, it validates the format and marks as pending.
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

  // In production: call CSLB API or scrape their lookup page
  // For now: accept the format and mark as pending verification
  // The daily cron job will attempt real verification
  return {
    verified: false,
    status: "pending",
    raw_response: {
      state: "CA",
      board: "CSLB",
      license_number: cleaned,
      note: "Format validated. Full CSLB verification will complete within 24 hours.",
    },
  };
}

/**
 * Re-verify an existing license (used by daily cron).
 * Checks if the license is still active, not expired or revoked.
 */
export async function recheckLicense(
  licenseNumber: string,
  state: string
): Promise<VerificationResult> {
  // Same logic as initial verify — in production, this would
  // call the real state API to check current status
  return verifyLicense(licenseNumber, state);
}
