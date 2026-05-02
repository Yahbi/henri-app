/**
 * POST /api/onboarding/verify-license
 *
 * Cross-checks a contractor's claimed (state, license_number) against
 * the public roster in `state_license_rosters` (Wave 2.B Phase 2).
 *
 * Body: { state: "TX", license_number: "12345" }
 *
 * Returns one of:
 *   - found    + business_name + license_status + expire_date
 *   - missing  (state IS in our roster but no matching license)
 *   - skipped  (state NOT in our roster — show manual-review prompt)
 *
 * Closes the wedge-contract bullet about license verification:
 * Henri's old onboarding just stored claims as `pending_verification`
 * — now we instantly verify against TX TDLR, NY NYC DCWP, WA L&I,
 * OR CCB, AZ ROC and surface the result inline. Unsupported states
 * (CA CSLB, FL DBPR, IL DFPR, NC NCLBGC, GA SOS) fall through to
 * "manual review" — those need scraper/login/paid-data work.
 *
 * Auth: any signed-in user (since this fires during onboarding,
 * before role finalization).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiError } from "@/lib/log";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  state: z.string().length(2),
  license_number: z.string().min(1).max(50),
});

interface VerifyResponse {
  status: "found" | "missing" | "skipped" | "error";
  state: string;
  license_number: string;
  /** Human-readable explanation. */
  message: string;
  /** When status='found': matching roster row fields. */
  match?: {
    business_name: string | null;
    license_type: string | null;
    license_status: string | null;
    issue_date: string | null;
    expire_date: string | null;
    city: string | null;
    zip: string | null;
    phone: string | null;
  };
  /** Source registry name + last_run_at, when status='skipped' tells
   *  the user which states ARE supported. */
  available_states?: string[];
}

export async function POST(request: NextRequest) {
  try {
    // Auth — any signed-in user.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { status: "error", message: "Not signed in" },
        { status: 401 },
      );
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { status: "error", message: "Invalid body" },
        { status: 400 },
      );
    }
    const state = body.state.toUpperCase();
    const license = body.license_number.trim();

    // Service-role client to bypass RLS on state_license_rosters.
    const admin = createAdminClient();

    // Step 1 — is this state actually represented in our roster?
    const { data: source } = await admin
      .from("contractor_license_sources")
      .select("state_code, enabled, last_inserted, source_kind")
      .eq("state_code", state)
      .eq("enabled", true)
      .maybeSingle();

    if (!source) {
      // State not in our verified-live set. Tell the user we'll
      // manually review and what states ARE supported.
      const { data: enabled } = await admin
        .from("contractor_license_sources")
        .select("state_code")
        .eq("enabled", true)
        .order("state_code");
      const available = (enabled ?? [])
        .map((r) => r.state_code as string)
        .filter(Boolean);
      const body: VerifyResponse = {
        status: "skipped",
        state,
        license_number: license,
        message: `${state} not yet in our verified-live roster — manual review required.`,
        available_states: available,
      };
      return NextResponse.json(body, { status: 200 });
    }

    // Step 2 — exact license-number lookup. License numbers can have
    // formatting variance (leading zeros, dashes), so we try the raw
    // value first then a normalized variant.
    const candidates = [license];
    const stripped = license.replace(/[^0-9A-Za-z]/g, "");
    if (stripped !== license) candidates.push(stripped);

    let match: Record<string, unknown> | null = null;
    for (const cand of candidates) {
      const { data } = await admin
        .from("state_license_rosters")
        .select(
          "business_name, license_type, license_status, issue_date, expire_date, city, zip, phone",
        )
        .eq("state_code", state)
        .eq("license_number", cand)
        .limit(1)
        .maybeSingle();
      if (data) {
        match = data as Record<string, unknown>;
        break;
      }
    }

    if (!match) {
      const body: VerifyResponse = {
        status: "missing",
        state,
        license_number: license,
        message: `License ${license} not found in ${state} roster. Double-check the number, or our roster may be a few days stale.`,
      };
      return NextResponse.json(body, { status: 200 });
    }

    const body2: VerifyResponse = {
      status: "found",
      state,
      license_number: license,
      message: `Verified — ${match.business_name || "license matched"} (${match.license_status || "active"})`,
      match: {
        business_name: typeof match.business_name === "string" ? match.business_name : null,
        license_type: typeof match.license_type === "string" ? match.license_type : null,
        license_status: typeof match.license_status === "string" ? match.license_status : null,
        issue_date: typeof match.issue_date === "string" ? match.issue_date : null,
        expire_date: typeof match.expire_date === "string" ? match.expire_date : null,
        city: typeof match.city === "string" ? match.city : null,
        zip: typeof match.zip === "string" ? match.zip : null,
        phone: typeof match.phone === "string" ? match.phone : null,
      },
    };
    return NextResponse.json(body2, { status: 200 });
  } catch (err) {
    logApiError("onboarding.verify-license", err);
    return NextResponse.json(
      { status: "error", message: "Verification failed unexpectedly" },
      { status: 500 },
    );
  }
}
