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
  /** Trade this holder claimed the ZIP for. Added by migration 00135. */
  trade: string | null;
  claimed_at: string;
}

export interface ZipAvailability {
  zip: string;
  /**
   * Active territories currently held on this ZIP.
   *
   * Under migration 00135's unique index on (zip, trade) WHERE
   * status='active', this is also the number of DISTINCT TRADES taken.
   */
  slots_used: number;
  /**
   * Maximum contractors one ZIP can hold: 10, the number of `trade_type`
   * values (was 3 before migration 00135 made exclusivity per-trade).
   *
   * Availability for a specific contractor is NOT `slots_used < slots_total`
   * — that only says the ZIP is not saturated across every trade. Ask
   * `get_zip_availability(zip, trade)` and read `available_for_trade`.
   */
  slots_total: number;
  /** Which trades are already taken. Never carries contractor identity. */
  taken_trades: string[];
  /**
   * Whether the queried trade can still claim this ZIP.
   *
   * TRI-STATE: `null` means no trade was supplied, i.e. UNKNOWN — never
   * treat it as available. A trade-blind caller reading this as a boolean is
   * exactly how the onboarding picker showed every ZIP as free and let
   * contractors get charged before the claim failed.
   */
  available_for_trade: boolean | null;
  contractors: ZipAvailabilityContractor[];
  waitlist_count: number;
}

export interface TerritoryClaimResult {
  success: boolean;
  message: string;
}
