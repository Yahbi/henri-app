import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recheckLicense } from "@/lib/license/verify";
import { logger } from "@/lib/logger";

/* Shared handler — Vercel Cron sends GET; manual triggers can use POST */
async function handler(request: NextRequest): Promise<NextResponse> {
  /* Validate CRON_SECRET bearer token */
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    // Fetch all active licenses that need re-checking
    const { data: licenses, error } = await supabase
      .from("contractor_licenses")
      .select("id, contractor_id, license_number, license_state, verification_status")
      .in("verification_status", ["verified", "pending"]);

    if (error) {
      logger.error("License fetch error", { error: String(error) });
      return NextResponse.json({ error: "Failed to fetch licenses" }, { status: 500 });
    }

    let checked = 0;
    let changed = 0;
    const issues: string[] = [];

    for (const license of licenses ?? []) {
      try {
        const result = await recheckLicense(license.license_number, license.license_state);
        checked++;

        // Only update if status changed
        if (result.status !== license.verification_status) {
          changed++;
          await supabase
            .from("contractor_licenses")
            .update({
              verified: result.verified,
              verification_status: result.status,
              last_checked_at: new Date().toISOString(),
              expiry_date: result.expiry_date ?? null,
              raw_response: result.raw_response ?? null,
            })
            .eq("id", license.id);

          // If license expired or revoked, notify contractor
          if (result.status === "expired" || result.status === "revoked") {
            issues.push(`License ${license.license_number} (${license.license_state}): ${result.status}`);
            await supabase
              .from("notifications")
              .insert({
                user_id: license.contractor_id,
                type: "system",
                title: "License Issue Detected",
                body: `Your license #${license.license_number} has been flagged as ${result.status}. Please update your license information to continue receiving leads.`,
                metadata: { license_id: license.id, status: result.status },
              });
          }
        }
      } catch (err) {
        logger.error("Failed to recheck license", { licenseId: license.id, error: String(err) });
      }
    }

    return NextResponse.json({
      success: true,
      checked,
      changed,
      issues,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("License check cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
