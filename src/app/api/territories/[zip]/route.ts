import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { getZipAvailability } from "@/lib/territory/ziplock";
import { releaseTerritory } from "@/lib/territory/ziplock";
import { logger } from "@/lib/logger";
import { isZip5 } from "@/lib/validation/params";
import { isTradeType } from "@/lib/territory/trades";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  try {
    const { zip } = await params;

    if (!isZip5(zip)) {
      return NextResponse.json(
        { error: "ZIP must be a 5-digit US ZIP code" },
        { status: 400 }
      );
    }

    /* ?trade= — optional, and the whole point of the endpoint since
     * migration 00135 made exclusivity per (zip, trade). Without it the RPC
     * can only answer "how many trades are taken", which is not the question
     * the contractor is asking: a ZIP with nine trades taken is still open
     * to the tenth, and a ZIP with one trade taken is CLOSED if that trade
     * is theirs. The onboarding picker used to read the trade-blind counts,
     * so every ZIP rendered available and the claim failed after checkout.
     *
     * Rejected rather than ignored when malformed: silently dropping a bad
     * label would answer the trade-blind question while the caller believed
     * it had asked the trade-specific one — the exact failure being fixed. */
    const tradeParam = request.nextUrl.searchParams.get("trade");
    if (tradeParam !== null && !isTradeType(tradeParam)) {
      return NextResponse.json(
        { error: "trade must be one of the trade_type values" },
        { status: 400 }
      );
    }

    const availability = await getZipAvailability(zip, tradeParam);

    // This endpoint is PUBLIC and unauthenticated by design — the ZIP
    // availability widget on /portal and the onboarding territory picker both
    // poll it without a session. get_zip_availability returns a `contractors`
    // array of raw contractor_id UUIDs, and returning those made the endpoint
    // the first link in an enumeration chain: probe ZIPs to harvest UUIDs,
    // then feed each UUID to the public contractor profile endpoint to read
    // back that contractor's full active-ZIP portfolio. Both routes read
    // through the service-role client, so RLS never applied.
    //
    // Nothing consumes the identities. Callers read slots_used / slots_total
    // and, since 00137, taken_trades + available_for_trade (see readSlots in
    // src/app/onboarding/territory/page.tsx) — occupancy and which TRADES are
    // gone, never who holds them. That is the same coarseness the wedge
    // contract requires of the "N contractors are watching" bucket.
    //
    // Kept as a key rather than dropped so any client destructuring
    // `contractors` gets a number instead of a crash.
    const { contractors, ...publicFields } = availability ?? {};

    return NextResponse.json({
      ...publicFields,
      contractors_count: Array.isArray(contractors) ? contractors.length : 0,
    });
  } catch (err) {
    logger.error("Error getting ZIP availability", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to get ZIP availability" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  try {
    const supabase = await createClient();

    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const { zip } = await params;

    if (!isZip5(zip)) {
      return NextResponse.json(
        { error: "ZIP must be a 5-digit US ZIP code" },
        { status: 400 }
      );
    }

    const result = await releaseTerritory(zip, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ released: true });
  } catch (err) {
    logger.error("Error releasing territory", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to release territory" },
      { status: 500 }
    );
  }
}
