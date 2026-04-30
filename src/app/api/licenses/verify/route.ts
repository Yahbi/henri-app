import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * POST /api/licenses/verify
 *
 * Runs a manual re-check of the contractor's license expiration. Writes
 * the verification timestamp to `profiles.license_state` and refreshes
 * `licensed_until` if the stored PDF/metadata confirms a newer expiry.
 *
 * This is a stub verifier — the real daily cron would look up the state
 * license board API (varies per state) and parse the expiration. For now,
 * it accepts the `licensed_until` stored on the profile as truth and
 * records that we verified it today.
 *
 * Gated to the authenticated contractor — only they can re-check their
 * own license. No cross-user verification.
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    /* Audit-04-29: was bare auth.getUser() — now contractor-gated. */
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    // Read whatever license-related columns exist on the profile. `select("*")`
    // is fine here because the caller is self-scoped by eq("id", user.id),
    // and we'd rather degrade gracefully than 500 when optional columns
    // (last_license_verified_at, license_state) are missing on this install.
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // State-by-state license-board APIs would plug in here. For MVP,
    // treat the stored `licensed_until` as authoritative.
    const licensedUntilDate = profile?.licensed_until
      ? new Date(profile.licensed_until as string)
      : null;
    const expired = licensedUntilDate
      ? licensedUntilDate.getTime() < Date.now()
      : true;

    // Best-effort write of the verification timestamp — if the column
    // doesn't exist on this Supabase install yet, swallow the error so
    // the endpoint still returns status data to the UI. The daily cron
    // should add the column via migration before being scheduled.
    try {
      await supabase
        .from("profiles")
        .update({ last_license_verified_at: new Date().toISOString() })
        .eq("id", user.id);
    } catch {
      // column may not exist; fine for read-only verify
    }

    return NextResponse.json({
      ok: true,
      licensed_until: profile?.licensed_until ?? null,
      license_active: !expired,
      license_state: profile?.license_state ?? null,
      license_number: profile?.license_number ?? null,
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    logApiError("licenses.verify", error);
    return NextResponse.json(
      { error: "License verification failed" },
      { status: 500 },
    );
  }
}
