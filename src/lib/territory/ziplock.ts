import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { TerritoryClaimResult, ZipAvailability } from "@/types/leads";

/**
 * Turn a `claim_territory` RAISE into something a contractor can act on.
 *
 * The RPC's messages are written for operators and carry a machine prefix
 * (`payment_required:`, `tier_cap_exceeded:`, `zip_taken_for_trade:`). They
 * were being returned to the browser verbatim, so a contractor blocked at
 * checkout read "payment_required: complete checkout to claim territories".
 *
 * Anything unrecognised is passed through unchanged rather than replaced with
 * a generic apology — an unexpected message the contractor can quote to
 * support beats a friendly one that says nothing.
 */
function humanizeClaimError(message: string, zip: string): string {
  if (message.includes("zip_taken_for_trade")) {
    // Deliberately does not name the holder. The wedge contract keeps
    // competitive intel coarse — "N other contractors are watching" is
    // bucketed and never named, and this must not become the back door.
    return `${zip} is already taken for your trade. Another trade in this ZIP may still be available.`;
  }
  if (message.includes("payment_required")) {
    return "Add a payment method to claim territories.";
  }
  if (message.includes("tier_cap_exceeded")) {
    // The RPC's text already carries the plan name and both counts, which is
    // exactly what the contractor needs; only the prefix is noise.
    return message.replace(/^tier_cap_exceeded:\s*/, "");
  }
  if (message.includes("already holds an active territory")) {
    return `You already hold ${zip}.`;
  }
  if (message.includes("slots are taken")) {
    return `${zip} is fully allocated.`;
  }
  return message;
}

export async function claimTerritory(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("claim_territory", {
    p_zip: zip,
    p_contractor_id: contractorId,
  });

  if (error) {
    // Logged raw so the operator keeps the prefix + full detail that the
    // contractor-facing string drops.
    logger.warn("territory.claim_rejected", { zip, contractorId, error: error.message });
    return { success: false, message: humanizeClaimError(error.message, zip) };
  }

  return {
    success: data?.success ?? true,
    message: data?.message ?? `Territory ${zip} claimed successfully`,
  };
}

export async function releaseTerritory(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("release_territory", {
    p_zip: zip,
    p_contractor_id: contractorId,
  });

  if (error) {
    return { success: false, message: error.message };
  }

  return {
    success: data?.success ?? true,
    message: data?.message ?? `Territory ${zip} released successfully`,
  };
}

export async function joinWaitlist(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("zip_waitlist").insert({
    zip,
    contractor_id: contractorId,
    created_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return { success: false, message: "Already on the waitlist for this ZIP" };
    }
    return { success: false, message: error.message };
  }

  return {
    success: true,
    message: `Added to waitlist for ZIP ${zip}`,
  };
}

export async function getZipAvailability(
  zip: string
): Promise<ZipAvailability | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("get_zip_availability", {
    p_zip: zip,
  });

  if (error) {
    logger.error("Error checking zip availability", { error: error.message });
    return null;
  }

  // Validate the shape instead of asserting it. The blind
  // `data as ZipAvailability` cast here is what let a wrong interface
  // (which claimed an `is_claimed` field the RPC never returns) survive
  // typechecking and silently break the onboarding availability check.
  const raw = data as Partial<ZipAvailability> | null;
  if (!raw || typeof raw.slots_used !== "number" || typeof raw.slots_total !== "number") {
    logger.error("get_zip_availability returned an unexpected shape", {
      zip,
      keys: raw ? Object.keys(raw).join(",") : "null",
    });
    return null;
  }

  return {
    zip: raw.zip ?? zip,
    slots_used: raw.slots_used,
    slots_total: raw.slots_total,
    contractors: raw.contractors ?? [],
    waitlist_count: raw.waitlist_count ?? 0,
  };
}
