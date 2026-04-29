import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyLicense } from "@/lib/license/verify";
import { LicenseVerifyBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/* POST /api/license/verify — verify a contractor license */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = parseBody(LicenseVerifyBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { license_number, state, license_type, holder_name } = parsed.data;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    if (existing) {
      await supabase
        .from("contractor_licenses")
        .update(licenseData)
        .eq("id", existing.id);
    } else {
      await supabase
        .from("contractor_licenses")
        .insert(licenseData);
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
