import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyLicense } from "@/lib/license/verify";

/* POST /api/license/verify — verify a contractor license */
export async function POST(req: NextRequest) {
  try {
    const { license_number, state, license_type, holder_name } = await req.json();

    if (!license_number || !state) {
      return NextResponse.json({ error: "License number and state are required" }, { status: 400 });
    }

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
    console.error("License verify error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
