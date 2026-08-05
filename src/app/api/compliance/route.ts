import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchAllTerritories } from "@/lib/territories/fetch-all";
import { logger } from "@/lib/logger";
import { requireContractor } from "@/lib/auth/requireContractor";

/* ─── Helpers ─── */

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil(
    (new Date(dateStr).getTime() - Date.now()) / 86_400_000
  );
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86_400_000
  );
}

function computeComplianceScore(
  license: Record<string, unknown> | null,
  profile: Record<string, unknown>,
  territories: Array<Record<string, unknown>>
): { score: number; warnings: string[] } {
  let score = 0;
  const warnings: string[] = [];

  // 1. License valid & not expired (40 pts)
  const hasLicense = !!license?.license_number;
  const expiry = (license?.expiry_date as string | null) ?? null;
  const expiryDays = daysUntil(expiry);
  const licenseExpired = expiryDays !== null && expiryDays <= 0;

  if (hasLicense && !licenseExpired) {
    score += 40;
  } else if (!hasLicense) {
    warnings.push("No license on file");
  } else if (licenseExpired) {
    warnings.push("License has expired");
  }

  // Expiry warnings (even if license is currently valid)
  if (expiryDays !== null && expiryDays > 0 && expiryDays <= 14) {
    warnings.push(`License expires in ${expiryDays} days`);
  } else if (expiryDays !== null && expiryDays > 14 && expiryDays <= 30) {
    warnings.push(`License expires in ${expiryDays} days`);
  }

  // 2. License verified within last 30 days (20 pts)
  const verifiedAt = (license?.last_checked_at as string | null) ?? null;
  const verified = license?.verified as boolean;
  const sinceDays = daysSince(verifiedAt);

  if (verified && sinceDays !== null && sinceDays <= 30) {
    score += 20;
  } else if (!verified) {
    warnings.push("License not verified");
  } else if (sinceDays !== null && sinceDays > 30) {
    warnings.push("License verification overdue");
  }

  // 3. Insurance on file (20 pts)
  const insuranceExpiry = profile.insurance_expiry as string | null | undefined;
  const insuranceDays = daysUntil(insuranceExpiry ?? null);
  const insuranceValid = insuranceDays !== null && insuranceDays > 0;

  if (insuranceValid) {
    score += 20;
  } else if (!insuranceExpiry) {
    warnings.push("No insurance on file");
  } else {
    warnings.push("Insurance has expired");
  }

  // 4. All territories active (20 pts)
  if (territories.length === 0) {
    warnings.push("No territories claimed");
  } else {
    const allActive = territories.every((t) => t.active === true);
    if (allActive) {
      score += 20;
    } else {
      const inactiveCount = territories.filter((t) => t.active !== true).length;
      warnings.push(
        `${inactiveCount} of ${territories.length} territor${territories.length === 1 ? "y" : "ies"} inactive`
      );
    }
  }

  return { score, warnings };
}

/* ─── GET /api/compliance ─── */

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    // Fetch license data from contractor_licenses
    const { data: licenseRows, error: licenseError } = await supabase
      .from("contractor_licenses")
      .select(
        "id, license_number, license_state, license_type, license_class, verified, verification_status, last_checked_at, expiry_date, holder_name"
      )
      .eq("contractor_id", user.id);

    if (licenseError) {
      throw new Error(licenseError.message);
    }

    // Use the first license (primary) for compliance scoring
    const license = licenseRows?.[0] ?? null;

    // Fetch profile for insurance_expiry
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("insurance_expiry")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw new Error(profileError.message);
    }

    // Fetch contractor territories (paginated — PostgREST caps unbounded
    // .select() at 1000 rows; founder has 5,601).
    type TerrRow = {
      id: string; zip: string; contractor_id: string; status: string;
      slot_number: number | null; claimed_at: string | null;
      released_at: string | null; created_at: string; updated_at: string;
    };
    const rawTerritories = await fetchAllTerritories<TerrRow>(
      supabase,
      user.id,
      "id, zip, contractor_id, status, slot_number, claimed_at, released_at, created_at, updated_at",
    );
    // Map status enum to active boolean for downstream consumers
    const territories = rawTerritories.map((t) => ({
      ...t,
      active: t.status === "active",
    }));

    // Fetch permit-related leads (join permits for permit_number)
    const { data: permits, error: permitsError } = await supabase
      .from("leads")
      .select("id, status, created_at, permits(permit_number)")
      .eq("contractor_id", user.id)
      .not("permit_id", "is", null);

    if (permitsError) {
      throw new Error(permitsError.message);
    }

    const { score, warnings } = computeComplianceScore(
      license,
      profile ?? {},
      territories ?? []
    );

    /* Map joined permit data to flat shape for the client */
    const mappedPermits = (permits ?? []).map((p) => {
      const permitData = Array.isArray(p.permits) ? p.permits[0] : p.permits;
      return {
        id: p.id,
        permit_number: (permitData as Record<string, unknown>)?.permit_number ?? null,
        status: p.status,
        created_at: p.created_at,
      };
    });

    return NextResponse.json(
      {
        license: {
          number: license?.license_number ?? null,
          state: license?.license_state ?? null,
          type: license?.license_type ?? null,
          expiry: license?.expiry_date ?? null,
          verified: license?.verified ?? false,
          verified_at: license?.last_checked_at ?? null,
        },
        insurance_expiry: profile?.insurance_expiry ?? null,
        territories: territories ?? [],
        permits: mappedPermits,
        compliance_score: score,
        warnings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("Error fetching compliance data", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch compliance data" },
      { status: 500 }
    );
  }
}

/* ── PATCH body schema ─── */
const CompliancePatchSchema = z.object({
  license_number: z.string().trim().min(1).max(60).optional(),
  license_state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/u, "license_state must be a 2-letter state code")
    .transform((v) => v.toUpperCase())
    .optional(),
  license_type: z.string().trim().max(80).optional(),
  license_expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "license_expiry must be YYYY-MM-DD")
    .optional(),
});

/* ─── PATCH /api/compliance ─── */

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    /* Zod-validated: `license_expiry` lands in a DATE column, so an
     * unvalidated string used to reach Postgres and come back as a 500
     * instead of a 400. The state code is normalized to the 2-letter form
     * the license-roster cross-check expects. */
    const parsed = CompliancePatchSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    const { license_number, license_state, license_type, license_expiry } =
      parsed.data;

    /* `expiry_date` is a TRUST column, not a self-declared one. Both
     * homeowner-facing read paths gate the "Licensed" badge on
     * `expiry_date.is.null,expiry_date.gte.<today>`
     * (/api/contractors/search:104, /api/contractors/[id]:75), so a
     * contractor who could set it would keep a dead licence's badge alive
     * indefinitely. Migration 00127 locks it against every non-service-role
     * session; the only writer is the roster cross-check in
     * /api/onboarding/verify-license, which copies the state registry's
     * own expiry. Reject loudly rather than silently dropping the field. */
    if (license_expiry !== undefined) {
      return NextResponse.json(
        {
          error:
            "License expiry can't be set by hand — it comes from the state licensing roster when your license is checked.",
        },
        { status: 400 }
      );
    }

    /* Build update payload — only the user-declared fields. `verified` and
     * `verification_status` used to be forced to false/'pending' here to
     * mark the licence as needing a re-check. That write is now rejected
     * by 00127, and it is also redundant: the same migration resets the
     * verdict automatically whenever `license_number` or `license_state`
     * changes, which are exactly the changes that invalidate it. */
    const updates: Record<string, unknown> = {};

    if (license_number !== undefined) updates.license_number = license_number;
    if (license_state !== undefined) updates.license_state = license_state;
    if (license_type !== undefined) updates.license_type = license_type;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one of license_number, license_state, license_type." },
        { status: 400 }
      );
    }

    // Check if contractor already has a license row
    const { data: existing } = await supabase
      .from("contractor_licenses")
      .select("id")
      .eq("contractor_id", user.id)
      .limit(1)
      .single();

    let updated;
    let updateError;

    if (existing) {
      // Update existing license
      const result = await supabase
        .from("contractor_licenses")
        .update(updates)
        .eq("contractor_id", user.id)
        .select(
          "license_number, license_state, license_type, expiry_date, verified, last_checked_at"
        )
        .single();
      updated = result.data;
      updateError = result.error;
    } else {
      // Insert new license row
      const result = await supabase
        .from("contractor_licenses")
        .insert({ contractor_id: user.id, ...updates })
        .select(
          "license_number, license_state, license_type, expiry_date, verified, last_checked_at"
        )
        .single();
      updated = result.data;
      updateError = result.error;
    }

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      license: {
        number: updated?.license_number ?? null,
        state: updated?.license_state ?? null,
        type: updated?.license_type ?? null,
        expiry: updated?.expiry_date ?? null,
        verified: updated?.verified ?? false,
        verified_at: updated?.last_checked_at ?? null,
      },
    });
  } catch (err) {
    logger.error("Error updating license info", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to update license info" },
      { status: 500 }
    );
  }
}
