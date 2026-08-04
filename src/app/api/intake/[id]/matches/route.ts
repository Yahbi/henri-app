import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/* GET /api/intake/[id]/matches -- returns matched contractors for an intake */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intakeId } = await params;

    if (!intakeId) {
      return NextResponse.json({ error: "Intake ID is required" }, { status: 400 });
    }

    const supabase = await createClient();

    /* Authenticate the user */
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch the intake to verify access */
    const { data: intake, error: intakeError } = await supabase
      .from("homeowner_intakes")
      .select("id, contact_email, matched_contractor_id, zip, trade, status")
      .eq("id", intakeId)
      .single();

    if (intakeError || !intake) {
      return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    }

    /* Authorization: homeowner who created it or a contractor matched to it */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single();

    const isHomeowner =
      profile?.role === "homeowner" && profile?.email === intake.contact_email;

    /* Check if this user is one of the matched contractors */
    const { data: matchRecord } = await supabase
      .from("intake_matches")
      .select("contractor_id")
      .eq("intake_id", intakeId)
      .eq("contractor_id", user.id)
      .maybeSingle();

    const isMatchedContractor =
      profile?.role === "contractor" &&
      (matchRecord !== null || intake.matched_contractor_id === user.id);

    if (!isHomeowner && !isMatchedContractor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /* Fetch match results with contractor public profiles */
    const { data: matches, error: matchError } = await supabase
      .from("intake_matches")
      .select(
        `rank, is_primary, contractor_id,
         profiles!inner(
           company_name, full_name, avg_rating, review_count,
           response_time_h, jobs_completed,
           badge_licensed, badge_insured, badge_background_checked,
           has_portfolio
         )`
      )
      .eq("intake_id", intakeId)
      .order("rank", { ascending: true });

    if (matchError) {
      logger.error("Match fetch error", { error: matchError instanceof Error ? matchError.message : String(matchError) });
      return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 });
    }

    /* Shape the response -- expose public info only, no internal scores or factors */
    type MatchRow = {
      rank: number;
      is_primary: boolean;
      contractor_id: string;
      profiles: {
        company_name?: string;
        full_name?: string;
        avg_rating?: number;
        review_count?: number;
        response_time_h?: number;
        jobs_completed?: number;
        badge_licensed?: boolean;
        badge_insured?: boolean;
        badge_background_checked?: boolean;
        has_portfolio?: boolean;
      } | Array<{
        company_name?: string;
        full_name?: string;
        avg_rating?: number;
        review_count?: number;
        response_time_h?: number;
        jobs_completed?: number;
        badge_licensed?: boolean;
        badge_insured?: boolean;
        badge_background_checked?: boolean;
        has_portfolio?: boolean;
      }>;
    };

    // Cast is necessary because Supabase's generated types for nested
    // foreignTable!inner(...) joins return `object | object[]` and don't match
    // the MatchRow shape precisely. The runtime shape is validated by the
    // Array.isArray(row.profiles) check in the map() below.
    const rows = (matches ?? []) as unknown as MatchRow[];

    const results = rows.map((row) => {
      const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const responseHours = p?.response_time_h;

      return {
        contractor_id: row.contractor_id,
        rank: row.rank,
        is_primary: row.is_primary,
        company_name: p?.company_name ?? p?.full_name ?? "Contractor",
        rating: p?.avg_rating ?? 0,
        review_count: p?.review_count ?? 0,
        response_time: formatResponseTime(responseHours),
        jobs_completed: p?.jobs_completed ?? 0,
        badges: {
          licensed: p?.badge_licensed ?? false,
          insured: p?.badge_insured ?? false,
          background_checked: p?.badge_background_checked ?? false,
        },
        has_portfolio: p?.has_portfolio ?? false,
      };
    });

    return NextResponse.json({
      intake_id: intakeId,
      trade: intake.trade,
      zip: intake.zip,
      status: intake.status,
      match_count: results.length,
      matches: results,
    });
  } catch (error) {
    logger.error("Matches GET error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function formatResponseTime(hours?: number | null): string {
  // No measured history → don't fabricate the fastest tier (see engine.ts).
  if (hours == null) return "response time not yet measured";
  if (hours < 1) return "within 1 hour";
  if (hours < 2) return "within 2 hours";
  if (hours < 4) return "within 4 hours";
  if (hours < 8) return "within 8 hours";
  if (hours < 24) return "within 24 hours";
  return "1-2 business days";
}
