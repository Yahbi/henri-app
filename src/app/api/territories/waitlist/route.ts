import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { joinWaitlist } from "@/lib/territory/ziplock";
import { requireContractor } from "@/lib/auth/requireContractor";
import { TerritoryClaimBodySchema, parseBody } from "@/lib/schemas/api";
import { logApiError } from "@/lib/log";

/**
 * POST /api/territories/waitlist — join the waitlist for a taken ZIP.
 *
 * Wraps `joinWaitlist()` from src/lib/territory/ziplock.ts (admin-client,
 * server-only) so the onboarding territory page can wire its "Join
 * waitlist" buttons. Contractor-gated like the claim endpoint; idempotent
 * at the DB layer (unique violation maps to a friendly 409).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const raw = await request.json();
    const parsed = parseBody(TerritoryClaimBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { zip } = parsed.data;

    const result = await joinWaitlist(zip, user.id);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }

    return NextResponse.json({ message: result.message }, { status: 201 });
  } catch (err) {
    logApiError("territories.waitlist", err);
    return NextResponse.json(
      { error: "Failed to join waitlist" },
      { status: 500 }
    );
  }
}
