import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { enrichProperty } from "@/lib/enrichment/pipeline";
import { logger } from "@/lib/logger";

/**
 * Property enrichment endpoint.
 * Fetches property details from county assessor data (free, public APIs)
 * with Census ACS fallback for universal coverage.
 *
 * GET /api/enrichment/property?address=...&city=...&state=...&zip=...&lat=...&lng=...
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireContractor(supabase);
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");
    const city = searchParams.get("city") ?? undefined;
    const state = searchParams.get("state") ?? undefined;
    const zip = searchParams.get("zip") ?? undefined;
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (!address) {
      return NextResponse.json(
        { error: "address parameter is required" },
        { status: 400 },
      );
    }

    const baseUrl = new URL(request.url).origin;

    const result = await enrichProperty(
      {
        address,
        city,
        state,
        zip,
        latitude: lat ? Number(lat) : undefined,
        longitude: lng ? Number(lng) : undefined,
      },
      { baseUrl },
    );

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, max-age=86400", // 24h client cache
      },
    });
  } catch (err) {
    logger.error("Property enrichment error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to enrich property data" },
      { status: 500 },
    );
  }
}
