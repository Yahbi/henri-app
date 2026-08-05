import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { TerritoryClaimResult, ZipAvailability } from "@/types/leads";

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
    return { success: false, message: error.message };
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
