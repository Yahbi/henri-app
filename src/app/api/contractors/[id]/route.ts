import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/* ─── GET /api/contractors/[id] — single contractor public profile ─── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createAdminClient();

    /* Fetch contractor profile */
    const { data: profile, error: profileErr } = await supabase
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
        years_experience,
        portfolio_photos,
        service_area
      `
      )
      .eq("id", id)
      .eq("role", "contractor")
      .eq("onboarding_completed", true)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: "Contractor not found" },
        { status: 404 }
      );
    }

    /* Fetch their territory ZIPs */
    const { data: territories } = await supabase
      .from("territories")
      .select("zip")
      .eq("contractor_id", id)
      .eq("status", "active");

    const zips = (territories ?? []).map((t) => t.zip);

    /* Fetch last 20 reviews */
    const { data: reviews } = await supabase
      .from("reviews")
      .select(
        `
        id,
        rating,
        title,
        body,
        reviewer_name,
        sentiment,
        created_at
      `
      )
      .eq("contractor_id", id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(20);

    const reviewList = reviews ?? [];

    /* Compute review stats */
    const totalReviews = reviewList.length;
    const avgRating =
      totalReviews > 0
        ? Math.round(
            (reviewList.reduce((sum, r) => sum + (r.rating ?? 0), 0) /
              totalReviews) *
              10
          ) / 10
        : 0;

    const starCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviewList) {
      const star = Math.max(1, Math.min(5, Math.round(r.rating ?? 0)));
      starCounts[star] = (starCounts[star] ?? 0) + 1;
    }

    return NextResponse.json({
      contractor: profile,
      territories: zips,
      reviews: reviewList,
      stats: {
        total_reviews: totalReviews,
        avg_rating: avgRating,
        stars: starCounts,
      },
    });
  } catch (err) {
    console.error("Contractor profile error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
