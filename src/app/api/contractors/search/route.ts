import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";

/* ─── GET /api/contractors/search — public contractor search for homeowners ─── */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIp(request);
  const rl = checkRateLimit(`contractor-search:${ip}`, { maxRequests: 30 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const { searchParams } = new URL(request.url);
    const zip = searchParams.get("zip");
    const trade = searchParams.get("trade");
    const sort = searchParams.get("sort") ?? "rating";

    if (!zip) {
      return NextResponse.json(
        { error: "zip query parameter is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    /* Find active contractor IDs in this ZIP */
    const { data: territories, error: tErr } = await supabase
      .from("territories")
      .select("contractor_id")
      .eq("zip", zip)
      .eq("status", "active");

    if (tErr) {
      console.error("Territory lookup error:", tErr);
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
      console.error("Contractor search error:", error);
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
    console.error("Contractor search error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
