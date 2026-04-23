import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getZipAvailability } from "@/lib/territory/ziplock";
import { releaseTerritory } from "@/lib/territory/ziplock";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  try {
    const { zip } = await params;

    if (!zip) {
      return NextResponse.json(
        { error: "ZIP code is required" },
        { status: 400 }
      );
    }

    const availability = await getZipAvailability(zip);

    return NextResponse.json(availability);
  } catch (err) {
    console.error("Error getting ZIP availability:", err);
    return NextResponse.json(
      { error: "Failed to get ZIP availability" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ zip: string }> }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { zip } = await params;

    if (!zip) {
      return NextResponse.json(
        { error: "ZIP code is required" },
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
    console.error("Error releasing territory:", err);
    return NextResponse.json(
      { error: "Failed to release territory" },
      { status: 500 }
    );
  }
}
