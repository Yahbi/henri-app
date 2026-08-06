import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * POST /api/compliance/verify
 *
 * On-demand license re-check. Reads the contractor's licence validity off
 * their profile and stamps `last_compliance_check_at`.
 *
 * It used to also return permit-expiration counts; those were derived from
 * a hardcoded 180-day validity window Henri has no data for, and were
 * removed 2026-08-06 (see the block comment in the handler).
 *
 * The UI uses this for the "Verify now" button. Previously that button
 * just called `refresh()` on the useCompliance hook without triggering
 * any server-side re-verification, so changes in the state license board
 * or permit expirations wouldn't be picked up until the next daily cron.
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    /* Audit-04-29: was bare auth.getUser() — now contractor-gated. The
     * route reads contractor-scoped license + lead data so a homeowner
     * session probing this endpoint should get a 403, not a noisy
     * empty-result 200. */
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

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

    /* 2026-08-06 truthfulness pass — the permit-expiration bucketing that
     * used to live here is deleted, not repaired.
     *
     * It pulled the contractor's open leads, added a hardcoded
     * `PERMIT_VALIDITY_DAYS = 180` to each joined permit's issued/applied
     * date, and returned `already_expired` / `expiring_in_30d` /
     * `expiring_in_90d` counts that the Compliance tab printed verbatim.
     * Henri ingests no permit expiry data — no such column exists in any
     * migration and no scraper captures one — so all three numbers were
     * arithmetic on an invented rule, presented to the contractor as
     * jurisdiction fact. The matching UI (an "Expires" column, an "Expired"
     * badge that overwrote the contractor's own CRM status, and an
     * address-level countdown banner) is gone from
     * dashboard/compliance/page.tsx in the same commit.
     *
     * It was also sampled wrong: `.limit(5000)` with no ORDER BY, against
     * PostgREST's hard 1,000-row ceiling, so the buckets described an
     * arbitrary thousand leads. That defect is moot now — but it is why the
     * fix is deletion rather than pagination. Bounding the sample of a
     * fabricated metric only makes the fabrication reproducible.
     *
     * This route is now what its name says: a license re-check. If a real
     * expiry field is ever ingested, count it here from that column.
     */

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
    });
  } catch (error) {
    logApiError("compliance.verify", error);
    return NextResponse.json(
      { error: "Compliance verification failed" },
      { status: 500 },
    );
  }
}
