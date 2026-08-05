import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyLicense } from "@/lib/license/verify";
import { LicenseVerifyBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";
import { requireContractor } from "@/lib/auth/requireContractor";

/* POST /api/license/verify — verify a contractor license */
export async function POST(req: NextRequest) {
  try {
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(LicenseVerifyBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { license_number, state, license_type, holder_name } = parsed.data;

    // Attempt verification
    const result = await verifyLicense(license_number, state, license_type);

    // Save or update license record
    const { data: existing } = await supabase
      .from("contractor_licenses")
      .select("id")
      .eq("contractor_id", user.id)
      .limit(1)
      .single();

    const licenseData = {
      contractor_id: user.id,
      license_number,
      license_state: state,
      license_type: license_type ?? null,
      holder_name: holder_name ?? null,
      verified: result.verified,
      verification_status: result.status,
      last_checked_at: new Date().toISOString(),
      expiry_date: result.expiry_date ?? null,
      raw_response: result.raw_response ?? null,
    };

    /* The trust columns (verified / verification_status / last_checked_at
     * / expiry_date / raw_response) are server-computed by verifyLicense
     * above and are locked against every non-service-role session by
     * migration 00127 — RLS gates rows, not columns, so leaving this write
     * on the caller's own session is what let a contractor self-award the
     * homeowner-facing "Licensed" badge. The admin client is the only role
     * allowed through; `contractor_id` still comes from the session and
     * both statements stay scoped to the caller's own row, so bypassing
     * RLS here grants no cross-tenant reach.
     *
     * The write error is surfaced now rather than swallowed: it used to be
     * discarded, so a rejected write returned "License verified
     * successfully" over a row that never changed. */
    const admin = createAdminClient();

    const { error: writeError } = existing
      ? await admin
          .from("contractor_licenses")
          .update(licenseData)
          .eq("id", existing.id)
          .eq("contractor_id", user.id)
      : await admin.from("contractor_licenses").insert(licenseData);

    if (writeError) {
      logger.error("License record write error", { error: writeError.message });
      return NextResponse.json(
        { error: "Could not save the license record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      verified: result.verified,
      status: result.status,
      message: result.error ?? (result.verified
        ? "License verified successfully"
        : "License submitted for verification. You'll be notified once verified."),
    });
  } catch (error) {
    logger.error("License verify error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
