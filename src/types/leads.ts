/**
 * Legacy type file — re-exports from lead.ts for backward compatibility.
 * New code should import from @/types/lead directly.
 */

export type { Lead, LeadUrgency as Urgency } from "./lead";

/** LeadData — simplified shape used by Twilio SMS and Resend email functions */
export interface LeadData {
  permitType: string;
  address: string;
  city: string;
  state: string;
  description: string | null;
  estimatedValue: number | null;
  score: number;
  urgency: "hot" | "warm" | "cool" | "cold";
}

export interface ZipAvailability {
  zip: string;
  is_claimed: boolean;
  contractor_id: string | null;
  waitlist_count: number;
}

export interface TerritoryClaimResult {
  success: boolean;
  message: string;
}
