import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";
import { z } from "zod";
import {
  EMPTY_CAPACITY_PREFS,
  isCapacityPrefs,
  type CapacityPrefs,
} from "@/lib/capacity/types";

/**
 * /api/capacity — contractor-level capacity preferences (Phase 0a).
 *
 *   GET    → { prefs: CapacityPrefs }
 *   PUT    → persist prefs
 *
 * Stored as a single jsonb column (`profiles.capacity_prefs`) added in
 * migration 00031. Graceful-degrades when the column is missing:
 *   - GET returns `EMPTY_CAPACITY_PREFS` (no filtering)
 *   - PUT returns 503 with a clear message so the UI can render
 *     "feature pending — migration 00031 needed" without crashing
 */

const CapacitySchema = z.object({
  max_radius_miles: z.number().int().min(0).max(500).nullable(),
  value_min: z.number().int().min(0).max(10_000_000).nullable(),
  value_max: z.number().int().min(0).max(10_000_000).nullable(),
  start_window_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  start_window_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  max_active_jobs: z.number().int().min(0).max(1000).nullable(),
  preferred_days_of_week: z.array(z.number().int().min(1).max(7)).max(7),
});

function missingColumn(msg: string | undefined): boolean {
  return !!msg && /capacity_prefs|schema cache/i.test(msg);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { data, error } = await supabase
      .from("profiles")
      .select("capacity_prefs")
      .eq("id", gate.user.id)
      .single();

    if (error) {
      if (missingColumn(error.message)) {
        return NextResponse.json({ prefs: EMPTY_CAPACITY_PREFS, migrationPending: true });
      }
      throw new Error(error.message);
    }

    const prefs = isCapacityPrefs(data?.capacity_prefs)
      ? (data.capacity_prefs as CapacityPrefs)
      : EMPTY_CAPACITY_PREFS;
    return NextResponse.json({ prefs });
  } catch (err) {
    logApiError("capacity.get", err);
    return NextResponse.json({ prefs: EMPTY_CAPACITY_PREFS });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const body = CapacitySchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: body.error.issues },
        { status: 400 },
      );
    }

    // value_min <= value_max sanity.
    if (
      body.data.value_min != null &&
      body.data.value_max != null &&
      body.data.value_min > body.data.value_max
    ) {
      return NextResponse.json(
        { error: "value_min must be \u2264 value_max" },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("profiles")
      .update({ capacity_prefs: body.data })
      .eq("id", gate.user.id);

    if (error) {
      if (missingColumn(error.message)) {
        return NextResponse.json(
          {
            error:
              "Capacity preferences not yet enabled. Apply migration 00031_wedge_trust.sql to activate.",
            migrationPending: true,
          },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, prefs: body.data });
  } catch (err) {
    logApiError("capacity.put", err);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }
}
