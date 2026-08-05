import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { generateResponseDraft } from "@/lib/reviews/response-generator";
import { logger } from "@/lib/logger";
import { ReviewSubmitBodySchema, parseBody } from "@/lib/schemas/api";
import { clampLimit, isUuid } from "@/lib/validation/params";

/* ─── GET /api/reviews — list reviews for a contractor (public) ─── */
export async function GET(request: NextRequest) {
  try {
    const contractorId = request.nextUrl.searchParams.get("contractor_id");

    /* Validate before it reaches Postgres — an unparseable uuid comes back
     * as a 22P02 that would otherwise surface as an opaque 500. */
    if (!isUuid(contractorId)) {
      return NextResponse.json(
        { error: "contractor_id must be a valid UUID" },
        { status: 400 }
      );
    }

    const limit = clampLimit(request.nextUrl.searchParams.get("limit"), 20, 100);
    const supabase = createAdminClient();

    // The reviews table has no `status` column (migration 00016 schema:
    // id, contractor_id, lead_id, reviewer_*, rating, title, body, trade,
    // zip, sentiment, ai_response, response_sent, verified, source,
    // created_at, responded_at). Public listing = source='henri' OR verified.
    const { data: reviews, error, count } = await supabase
      .from("reviews")
      .select(
        `
        id,
        rating,
        title,
        body,
        reviewer_name,
        sentiment,
        verified,
        source,
        created_at
      `,
        { count: "exact" }
      )
      .eq("contractor_id", contractorId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("Reviews fetch error", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: "Failed to fetch reviews" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      reviews: reviews ?? [],
      total: count ?? 0,
    });
  } catch (err) {
    logger.error("Reviews GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── Helper: detect sentiment from rating ─── */
function detectSentiment(
  rating: number
): "positive" | "neutral" | "negative" {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

/* ─── POST /api/reviews — submit a review ─── */
/*
 * Accepts either:
 *  - A valid review_request token (for unauthenticated review links)
 *  - An authenticated user session
 */
export async function POST(req: NextRequest) {
  /* IP rate limit — review submission is reachable without a session
   * (token path), so cap unauthenticated spam the same way /api/intake
   * does for homeowner submissions. */
  const ip = getClientIp(req);
  const rl = checkRateLimit(`reviews.submit:${ip}`, {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(ReviewSubmitBodySchema, raw);
    if (parsed.response) return parsed.response;
    const {
      token,
      contractor_id,
      rating,
      title,
      body: reviewBody,
      reviewer_name,
      reviewer_email,
    } = parsed.data;

    const adminSupabase = createAdminClient();
    let reviewRequestId: string | null = null;
    let leadTrade: string | null = null;
    let leadZip: string | null = null;

    /* Validate token if provided */
    if (token) {
      const { data: reviewRequest, error: tokenErr } = await adminSupabase
        .from("review_requests")
        .select("id, contractor_id, lead_id, status, expires_at")
        .eq("token", token)
        .single();

      if (tokenErr || !reviewRequest) {
        return NextResponse.json(
          { error: "Invalid review token" },
          { status: 400 }
        );
      }

      if (reviewRequest.status === "completed") {
        return NextResponse.json(
          { error: "This review link has already been used" },
          { status: 400 }
        );
      }

      if (
        reviewRequest.expires_at &&
        new Date(reviewRequest.expires_at) < new Date()
      ) {
        return NextResponse.json(
          { error: "This review link has expired" },
          { status: 400 }
        );
      }

      if (reviewRequest.contractor_id !== contractor_id) {
        return NextResponse.json(
          { error: "Token does not match contractor" },
          { status: 400 }
        );
      }

      reviewRequestId = reviewRequest.id;

      /* Extract trade and zip from the associated lead */
      if (reviewRequest.lead_id) {
        const { data: lead } = await adminSupabase
          .from("leads")
          .select("trade, zip")
          .eq("id", reviewRequest.lead_id)
          .single();

        if (lead) {
          leadTrade = lead.trade ?? null;
          leadZip = lead.zip ?? null;
        }
      }
    } else {
      /* No token — require authentication */
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: "Authentication or a valid review token is required" },
          { status: 401 }
        );
      }
    }

    const sentiment = detectSentiment(rating);

    /* Generate AI response draft */
    const aiResponse = generateResponseDraft({
      rating,
      body: reviewBody ?? null,
      reviewer_name: reviewer_name ?? "Customer",
      trade: leadTrade,
    });

    /* Insert the review */
    const { data: review, error: insertErr } = await adminSupabase
      .from("reviews")
      .insert({
        contractor_id,
        review_request_id: reviewRequestId,
        rating,
        title: title ?? null,
        body: reviewBody ?? null,
        reviewer_name,
        reviewer_email: reviewer_email ?? null,
        trade: leadTrade,
        zip: leadZip,
        sentiment,
        ai_response: aiResponse,
        source: token ? "request" : "direct",
        status: "published",
      })
      .select()
      .single();

    if (insertErr) {
      logger.error("Review insert error", { error: insertErr instanceof Error ? insertErr.message : String(insertErr) });
      return NextResponse.json(
        { error: "Failed to submit review" },
        { status: 500 }
      );
    }

    /* Mark the review request as completed if token was used */
    if (reviewRequestId) {
      await adminSupabase
        .from("review_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", reviewRequestId);
    }

    /* Notify the contractor about the new review */
    try {
      const { data: contractorProfile } = await adminSupabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", contractor_id)
        .single();

      if (contractorProfile?.email) {
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          const starText = `${"*".repeat(rating)}${"_".repeat(5 - rating)}`;
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              /* 2026-04-30 canonical email policy: contractor-facing
               * notifications come from support@ so any "this looks
               * wrong" reply from the contractor lands in the monitored
               * inbox. Pre-04-30 used noreply@ which dropped contractor
               * follow-ups on the floor. */
              from: "Henri <support@meethenri.com>",
              to: [contractorProfile.email],
              reply_to: ["support@meethenri.com"],
              subject: `New ${rating}-star review from ${reviewer_name}`,
              html: `
                <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
                  <h2 style="color: #1a1a1a;">New Review Received</h2>
                  <p style="color: #555; line-height: 1.6;">
                    <strong>${reviewer_name}</strong> left a <strong>${rating}/5</strong> review ${starText}
                  </p>
                  ${title ? `<p style="color: #333; font-weight: 600;">${title}</p>` : ""}
                  ${reviewBody ? `<p style="color: #555; line-height: 1.6;">"${reviewBody}"</p>` : ""}
                  <p style="color: #555; line-height: 1.6; margin-top: 16px;">
                    <strong>Suggested response (edit before sending):</strong>
                  </p>
                  <p style="color: #666; line-height: 1.6; background: #f5f5f5; padding: 12px 16px; border-radius: 8px; font-style: italic;">
                    ${aiResponse}
                  </p>
                  <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com"}/dashboard/reputation"
                     style="display: inline-block; background: #D4886A; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                    View in Dashboard
                  </a>
                </div>
              `,
            }),
          });
          if (!emailRes.ok) {
            // Don't throw — email failure must not invalidate a saved review.
            // Logged so ops can see rate-limit / invalid-key issues.
            logger.warn("Resend notification failed", {
              status: emailRes.status,
              body: await emailRes.text().catch(() => ""),
            });
          }
        }
      }
    } catch (notifyErr) {
      /* Non-blocking: review is saved even if notification fails */
      logger.error("Contractor notification error", { error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr) });
    }

    /* Refresh contractor stats via RPC */
    try {
      await adminSupabase.rpc("refresh_contractor_stats", {
        p_contractor_id: contractor_id,
      });
    } catch (rpcErr) {
      /* Non-blocking: review is saved even if stats refresh fails */
      logger.error("refresh_contractor_stats RPC error", { error: rpcErr instanceof Error ? rpcErr.message : String(rpcErr) });
    }

    return NextResponse.json(
      { success: true, review },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Reviews POST error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
