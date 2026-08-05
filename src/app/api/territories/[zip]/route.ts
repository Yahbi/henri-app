import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { getZipAvailability } from "@/lib/territory/ziplock";
import { releaseTerritory } from "@/lib/territory/ziplock";
import { logger } from "@/lib/logger";
import { isZip5 } from "@/lib/validation/params";

export async function GET(
  _request: NextRequest,
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

    const availability = await getZipAvailability(zip);

    return NextResponse.json(availability);
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
