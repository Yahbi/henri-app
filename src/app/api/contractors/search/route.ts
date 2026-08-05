import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/logger";
import { isZip5, sanitizeFilterText } from "@/lib/validation/params";

/* ─── GET /api/contractors/search — public contractor search for homeowners ─── */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIp(request);
  const rl = checkRateLimit(`contractor-search:${ip}`, { maxRequests: 30 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const { searchParams } = new URL(request.url);
    const zip = searchParams.get("zip");
    /* `trade` lands in a PostgREST ilike filter — strip the characters that
     * carry meaning there (`,` `(` `)` `%` `_`) so a crafted value can't
     * widen or restructure the filter. */
    const trade = sanitizeFilterText(searchParams.get("trade"), 40);
    const sort = searchParams.get("sort") ?? "rating";

    if (!isZip5(zip)) {
      return NextResponse.json(
        { error: "zip must be a 5-digit US ZIP code" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    /* Find active contractor IDs in this ZIP */
    const { data: territories, error: tErr } = await supabase
      .from("territories")
      .select("contractor_id")
      .eq("zip", zip)
      .eq("status", "active")
      .limit(200);

    if (tErr) {
      logger.error("Territory lookup error", { error: tErr instanceof Error ? tErr.message : String(tErr) });
      return NextResponse.json(
        { error: "Failed to search contractors" },
        { status: 500 }
      );
    }

    const contractorIds = (territories ?? []).map((t) => t.contractor_id);

    if (contractorIds.length === 0) {
      return NextResponse.json({ contractors: [], total: 0 });
    }

    /* Build profile query */
    let query = supabase
      .from("profiles")
      .select(
        `
        id,
        company_name,
        full_name,
        trade,
        avg_rating,
        review_count,
        jobs_completed,
        response_time_h,
        badge_licensed,
        badge_insured,
        badge_background,
        verified_at,
        bio,
        specialties,
        years_experience
      `,
        { count: "exact" }
      )
      .in("id", contractorIds)
      .eq("role", "contractor")
      .eq("onboarding_completed", true);

    /* Apply trade filter */
    if (trade) {
      query = query.ilike("trade", `%${trade}%`);
    }

    /* Sort by the specified field */
    const sortMap: Record<string, { column: string; ascending: boolean }> = {
      rating: { column: "avg_rating", ascending: false },
      response_time: { column: "response_time_h", ascending: true },
      jobs: { column: "jobs_completed", ascending: false },
    };

    const sortConfig = sortMap[sort] ?? sortMap.rating;
    query = query.order(sortConfig.column, {
      ascending: sortConfig.ascending,
      nullsFirst: false,
    });

    query = query.limit(20);

    const { data: contractors, error, count } = await query;

    if (error) {
      logger.error("Contractor search error", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: "Failed to search contractors" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      contractors: contractors ?? [],
      total: count ?? 0,
    });
  } catch (err) {
    logger.error("Contractor search error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
