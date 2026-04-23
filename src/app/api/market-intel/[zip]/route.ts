import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";

/**
 * GET /api/market-intel/[zip] — trailing-90-day market intel for one ZIP.
 *
 * Returns:
 *   {
 *     zip, state, permit_count_90d, total_value_90d, avg_value_90d,
 *     permit_count_mom_delta_pct,
 *     top_trades: [{trade, count, total_value}, ...],
 *     top_applicants: [{name, count, total_value}, ...],
 *     as_of
 *   }
 *
 * Graceful-degrades when migration 00034 hasn't run → 503 with a
 * clear `migrationPending: true` signal. The UI panel swaps to a
 * "waiting on nightly refresh" state.
 */

function tableMissing(msg: string | null | undefined): boolean {
  return !!msg && /Could not find the table|does not exist|schema cache/i.test(msg);
}

interface RouteContext {
  params: Promise<{ zip: string }>;
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { zip } = await ctx.params;
    const cleanZip = zip.slice(0, 5).replace(/[^0-9]/g, "");
    if (cleanZip.length !== 5) {
      return NextResponse.json({ error: "Invalid ZIP" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("market_intel_zip")
      .select("*")
      .eq("zip", cleanZip)
      .maybeSingle();

    if (error) {
      if (tableMissing(error.message)) {
        return NextResponse.json({ intel: null, migrationPending: true });
      }
      throw new Error(error.message);
    }

    return NextResponse.json(
      { intel: data ?? null },
      {
        headers: {
          // Refresh runs nightly — 6h client cache is generous for a
          // panel-level read.
          "Cache-Control": "private, max-age=21600",
        },
      },
    );
  } catch (err) {
    logApiError("market-intel.get", err);
    return NextResponse.json({ intel: null });
  }
}
