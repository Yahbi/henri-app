import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { ReviewRespondBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * POST /api/reviews/respond
 * Body: { review_id: string, reply: string }
 *
 * Saves a drafted reply to a review. When the Google Business Profile
 * API is wired (feature flag REPUTATION_GBP_LIVE), Google reviews
 * additionally post the reply live. Until then, all platforms save as
 * `status: "draft"` in the `review_responses` table so the contractor
 * can track what they wrote and paste into the platform manually.
 *
 * Previously the reputation page's handleSend flipped local state only
 * with a `// TODO: POST to /api/reviews/respond` comment — this endpoint
 * is that TODO.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(ReviewRespondBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { review_id: reviewId, reply } = parsed.data;

    // Write the draft. We use upsert so re-submitting replaces the
    // previous draft rather than creating duplicates.
    const now = new Date().toISOString();
    const { error } = await supabase.from("review_responses").upsert(
      {
        contractor_id: user.id,
        review_id: reviewId,
        reply,
        status: "draft",
        updated_at: now,
        created_at: now,
      },
      { onConflict: "review_id,contractor_id" },
    );

    if (error) {
      // Table may not exist on all installs yet — surface a clear 501
      // rather than a 500 so the client can degrade gracefully.
      if (error.message?.includes("relation") || error.code === "42P01") {
        // Operator breadcrumb stays server-side only: run migration
        // 00026_review_responses.sql. Don't leak schema details to clients.
        logApiError("reviews.respond.table_missing", error, {
          hint: "Run migration 00026_review_responses.sql",
        });
        return NextResponse.json(
          { error: "review_responses table not yet migrated" },
          { status: 501 },
        );
      }
      throw error;
    }

    const gbpLive = process.env.REPUTATION_GBP_LIVE === "1";
    return NextResponse.json({
      ok: true,
      status: "draft",
      gbp_live: gbpLive,
      note: gbpLive
        ? "Draft saved. Google posting flow requires OAuth re-consent (not implemented)."
        : "Draft saved. Copy it into the platform to publish — automated posting is planned.",
    });
  } catch (error) {
    logApiError("reviews.respond", error);
    return NextResponse.json(
      { error: "Failed to save reply" },
      { status: 500 },
    );
  }
}
