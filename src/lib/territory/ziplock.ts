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

  return data as ZipAvailability;
}
