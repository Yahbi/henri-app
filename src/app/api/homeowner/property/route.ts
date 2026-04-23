import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * Homeowner property GET/PATCH.
 *
 * Stores a homeowner's home value, mortgage balance, year built, sqft
 * etc. so the PropertyTracker component stops showing hard-coded demo
 * values. Keyed by auth user id; homeowner owns one row.
 *
 * Expects table `homeowner_properties` — SQL for that table is in
 * `supabase/manual-apply-phase1.sql` (Phase 1.6 handoff file).
 */
type PropertyRow = {
  owner_id: string;
  zip: string | null;
  home_value: number | null;
  mortgage: number | null;
  year_built: number | null;
  home_sqft: number | null;
  lot_sqft: number | null;
  updated_at?: string;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("homeowner_properties")
      .select("zip, home_value, mortgage, year_built, home_sqft, lot_sqft, updated_at")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (error) {
      logApiError("homeowner.property.get", error);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }

    return NextResponse.json({ property: data ?? null });
  } catch (err) {
    logApiError("homeowner.property.get.catch", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<
      Omit<PropertyRow, "owner_id" | "updated_at">
    >;

    const patch: Partial<PropertyRow> = {
      owner_id: user.id,
      updated_at: new Date().toISOString(),
    };

    // Only pass through fields the client actually sent — leaves existing
    // values untouched on partial PATCH.
    const passthrough: Array<keyof PropertyRow> = [
      "zip",
      "home_value",
      "mortgage",
      "year_built",
      "home_sqft",
      "lot_sqft",
    ];
    for (const key of passthrough) {
      if (key in body) {
        (patch as Record<string, unknown>)[key] =
          body[key as keyof typeof body] ?? null;
      }
    }

    const { data, error } = await supabase
      .from("homeowner_properties")
      .upsert(patch, { onConflict: "owner_id" })
      .select("zip, home_value, mortgage, year_built, home_sqft, lot_sqft, updated_at")
      .single();

    if (error) {
      logApiError("homeowner.property.patch", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    return NextResponse.json({ property: data });
  } catch (err) {
    logApiError("homeowner.property.patch.catch", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
