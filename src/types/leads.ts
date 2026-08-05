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

/**
 * Shape of the `get_zip_availability(p_zip)` RPC payload.
 *
 * Corrected 2026-08-04. The previous declaration invented `is_claimed`
 * and `contractor_id`, neither of which the function has ever returned
 * (see supabase/migrations/00008_ziplock_rpc.sql — the jsonb_build_object
 * emits zip / slots_used / slots_total / contractors / waitlist_count).
 * The onboarding territory step read `!data.is_claimed`, which was
 * always `!undefined === true`, so every ZIP rendered "Available"
 * regardless of occupancy. `ziplock.ts` casts the RPC result to this
 * type without validation, so the type was the only thing that could
 * have caught it.
 */
export interface ZipAvailabilityContractor {
  contractor_id: string;
  slot_number: number;
  claimed_at: string;
}

export interface ZipAvailability {
  zip: string;
  /** Active territories currently held on this ZIP. */
  slots_used: number;
  /** Capacity per ZIP enforced by claim_territory. Currently 3. */
  slots_total: number;
  contractors: ZipAvailabilityContractor[];
  waitlist_count: number;
}

export interface TerritoryClaimResult {
  success: boolean;
  message: string;
}
