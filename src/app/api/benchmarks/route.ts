import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { sanitizeFilterText } from "@/lib/validation/params";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const zip = searchParams.get("zip");

    if (!zip) {
      return NextResponse.json(
        { error: "zip query parameter is required" },
        { status: 400 }
      );
    }

    /* Validate before slicing — the prefix is only meaningful once the
     * input is known to be numeric. */
    if (!/^\d{3,5}$/.test(zip)) {
      return NextResponse.json(
        { error: "zip must be a 3 or 5 digit ZIP code" },
        { status: 400 }
      );
    }

    const zipPrefix = zip.slice(0, 3);

    const supabase = await createClient();

    // Column names match migration 00016: cost_low / cost_avg / cost_high,
    // last_updated. Previous code referenced min_cost/avg_cost/max_cost which
    // don't exist — that was the 500.
    let query = supabase
      .from("cost_benchmarks")
      .select("id, zip_prefix, trade, project_type, cost_low, cost_avg, cost_high, unit, sample_size, last_updated")
      .eq("zip_prefix", zipPrefix);

    const trade = sanitizeFilterText(searchParams.get("trade"), 40);
    if (trade) {
      query = query.eq("trade", trade);
    }

    const projectType = sanitizeFilterText(searchParams.get("project_type"), 60);
    if (projectType) {
      query = query.eq("project_type", projectType);
    }

    /* Bound the read. One ZIP prefix holds a few dozen benchmark rows today,
     * but an unbounded select on a public, cached endpoint is a footgun the
     * moment the table grows. */
    const { data: benchmarks, error } = await query.order("trade").limit(200);

    if (error) {
      logger.error("benchmarks query failed", { message: error.message });
      return NextResponse.json(
        { error: "Failed to fetch benchmarks" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { benchmarks: benchmarks ?? [], zip_prefix: zipPrefix },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (err) {
    logger.error("Error fetching benchmarks", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch benchmarks" },
      { status: 500 }
    );
  }
}
