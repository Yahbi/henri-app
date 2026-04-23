import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimTerritory } from "@/lib/territory/ziplock";
import { requireContractor } from "@/lib/auth/requireContractor";
import { TerritoryClaimBodySchema, parseBody } from "@/lib/schemas/api";
import { logApiError } from "@/lib/log";
import { fetchAllTerritories } from "@/lib/territories/fetch-all";

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    // PostgREST caps single-response selects at 1000 rows — use the
    // shared paginator so the founder's 5,601 claimed ZIPs don't get
    // silently truncated here.
    type Row = { id: string; contractor_id: string; zip: string; status: string; slot_number: number | null; claimed_at: string; created_at: string };
    const territories = await fetchAllTerritories<Row>(
      supabase,
      user.id,
      "id, contractor_id, zip, status, slot_number, claimed_at, created_at",
      { activeOnly: true, orderBy: { column: "claimed_at", ascending: false } },
    );

    return NextResponse.json(
      { territories },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logApiError("territories.list", err);
    return NextResponse.json(
      { error: "Failed to list territories" },
      { status: 500 }
    );
  }
}

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

    const result = await claimTerritory(zip, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 409 }
      );
    }

    return NextResponse.json({ message: result.message }, { status: 201 });
  } catch (err) {
    logApiError("territories.claim", err);
    return NextResponse.json(
      { error: "Failed to claim territory" },
      { status: 500 }
    );
  }
}
