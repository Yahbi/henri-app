import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validation/params";

/* ─── GET /api/contractors/[id] — single contractor public profile ─── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: "Contractor not found" },
        { status: 404 }
      );
    }

    const supabase = createAdminClient();

    /* Fetch contractor profile.
     *
     * `badge_licensed` / `badge_insured` / `badge_background` / `verified_at`
     * used to be selected here and are deliberately gone: no code path in
     * src/ writes any of them (migration 00117 locks them against every
     * non-service-role session precisely because they were dead trust
     * signals), so they are false/null for every contractor and publishing
     * them asserts checks Henri never ran. The licence block below is
     * derived from the roster cross-check instead — the one licensing
     * signal Henri actually produces. Insurance and background checks have
     * no field at all because Henri collects neither. */
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

    /* Licence trust block — a match against `state_license_rosters` recorded
     * by /api/onboarding/verify-license. An expired licence is not a
     * licence; a NULL expiry means the roster doesn't publish one, which is
     * not the same as expired. Degrades to "no badge" on error rather than
     * failing the whole profile fetch. */
    const today = new Date().toISOString().slice(0, 10);
    const { data: license, error: licenseErr } = await supabase
      .from("contractor_licenses")
      .select("license_state, last_checked_at")
      .eq("contractor_id", id)
      .eq("verified", true)
      .or(`expiry_date.is.null,expiry_date.gte.${today}`)
      .order("last_checked_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (licenseErr) {
      logger.warn("Contractor licence lookup failed; licence badge suppressed", {
        error: licenseErr.message,
      });
    }

    /* Fetch their territory ZIPs */
    const { data: territories } = await supabase
      .from("territories")
      .select("zip")
      .eq("contractor_id", id)
      .eq("status", "active");

    const zips = (territories ?? []).map((t) => t.zip);

    /* Fetch last 20 reviews. `count: "exact"` runs against the full filtered
     * set, not the page — `reviewList.length` was being reported as
     * `total_reviews`, which silently capped the published total at 20. */
    const { data: reviews, count: reviewCount } = await supabase
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
      `,
        { count: "exact" }
      )
      .eq("contractor_id", id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(20);

    const reviewList = reviews ?? [];

    /* Stats below are computed over the 20 most recent reviews only — that's
     * what we fetched. `sample_size` is returned alongside so a caller can't
     * mistake a 20-review average for the contractor's lifetime average. */
    const sampleSize = reviewList.length;
    const avgRating =
      sampleSize > 0
        ? Math.round(
            (reviewList.reduce((sum, r) => sum + (r.rating ?? 0), 0) /
              sampleSize) *
              10
          ) / 10
        : 0;

    const starCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviewList) {
      const star = Math.max(1, Math.min(5, Math.round(r.rating ?? 0)));
      starCounts[star] = (starCounts[star] ?? 0) + 1;
    }

    return NextResponse.json({
      contractor: {
        ...profile,
        license_verified: !!license,
        license_state: license?.license_state ?? null,
        license_verified_at: license?.last_checked_at ?? null,
      },
      territories: zips,
      reviews: reviewList,
      stats: {
        total_reviews: reviewCount ?? sampleSize,
        avg_rating: avgRating,
        avg_rating_sample_size: sampleSize,
        stars: starCounts,
      },
    });
  } catch (err) {
    logger.error("Contractor profile error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
