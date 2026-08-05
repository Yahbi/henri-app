import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

/* ── PATCH body schema ── */
const PropertyPatchSchema = z.object({
  zip: z.string().regex(/^\d{5}$/u, "zip must be a 5-digit US ZIP").nullish(),
  home_value: z.number().finite().min(0).max(1_000_000_000).nullish(),
  mortgage: z.number().finite().min(0).max(1_000_000_000).nullish(),
  year_built: z.number().int().min(1600).max(2200).nullish(),
  home_sqft: z.number().int().min(0).max(1_000_000).nullish(),
  lot_sqft: z.number().int().min(0).max(100_000_000).nullish(),
});

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

    /* Zod-validated: these columns are numeric/text in Postgres, so an
     * unvalidated `home_value: "lots"` used to surface as a 500 rather than
     * a 400. Bounds are generous but finite. */
    const parsed = PropertyPatchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const body = parsed.data;

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
