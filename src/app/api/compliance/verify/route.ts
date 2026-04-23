import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * POST /api/compliance/verify
 *
 * On-demand compliance re-check. Composes the same data the daily cron
 * would — license validity + permit expirations — and returns a single
 * consolidated summary.
 *
 * The UI uses this for the "Verify now" button. Previously that button
 * just called `refresh()` on the useCompliance hook without triggering
 * any server-side re-verification, so changes in the state license board
 * or permit expirations wouldn't be picked up until the next daily cron.
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. License check — read profile + (if licensed_until column exists)
    // decide whether leads should be paused.
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const licensedUntil = profile?.licensed_until
      ? new Date(profile.licensed_until as string)
      : null;
    const licenseExpired = licensedUntil
      ? licensedUntil.getTime() < Date.now()
      : !profile?.licensed_until;
    const licenseExpiringSoon = licensedUntil
      ? licensedUntil.getTime() - Date.now() < 30 * 86_400_000
      : false;

    // 2. Permit expiration check — count leads whose permits will expire
    // within 30 days (scorer uses 180-day default validity window).
    const PERMIT_VALIDITY_DAYS = 180;
    const thirtyDaysAhead = Date.now() + 30 * 86_400_000;
    const ninetyDaysAhead = Date.now() + 90 * 86_400_000;

    const { data: leads } = await supabase
      .from("leads")
      .select("id, status, permits (issued_date, applied_date)")
      .eq("contractor_id", user.id)
      .in("status", ["new", "contacted", "quoted", "proposal"])
      .limit(5000);

    let expiringSoon = 0;
    let expiringLater = 0;
    let alreadyExpired = 0;
    for (const lead of leads ?? []) {
      const p = (lead.permits as unknown as { issued_date?: string; applied_date?: string } | null);
      const filedStr = p?.issued_date ?? p?.applied_date;
      if (!filedStr) continue;
      const expiresAt = new Date(filedStr).getTime() + PERMIT_VALIDITY_DAYS * 86_400_000;
      if (expiresAt < Date.now()) alreadyExpired++;
      else if (expiresAt < thirtyDaysAhead) expiringSoon++;
      else if (expiresAt < ninetyDaysAhead) expiringLater++;
    }

    // Optional: record the check on the profile.
    try {
      await supabase
        .from("profiles")
        .update({ last_compliance_check_at: new Date().toISOString() })
        .eq("id", user.id);
    } catch {
      /* column may not exist — not fatal */
    }

    return NextResponse.json({
      verified_at: new Date().toISOString(),
      license: {
        state: profile?.license_state ?? null,
        expires_at: profile?.licensed_until ?? null,
        expired: licenseExpired,
        expiring_soon: licenseExpiringSoon,
        leads_paused: licenseExpired,
      },
      permits: {
        already_expired: alreadyExpired,
        expiring_in_30d: expiringSoon,
        expiring_in_90d: expiringLater,
        validity_days: PERMIT_VALIDITY_DAYS,
      },
    });
  } catch (error) {
    logApiError("compliance.verify", error);
    return NextResponse.json(
      { error: "Compliance verification failed" },
      { status: 500 },
    );
  }
}
