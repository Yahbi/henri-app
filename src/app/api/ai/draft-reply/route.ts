import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * POST /api/ai/draft-reply
 * Body: { rating: number, text: string, platform?: string, reviewer_name?: string }
 *
 * Generates a thoughtful review response using Anthropic Claude. The
 * reputation page previously had a hardcoded if/else that emitted the
 * same three canned replies for every review — this replaces it with
 * a real LLM call scoped to the contractor's business context.
 *
 * Falls back to the prior canned replies when ANTHROPIC_API_KEY is not
 * configured so the feature still functions in development environments
 * without an API key.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      rating?: number;
      text?: string;
      platform?: string;
      reviewer_name?: string;
    };
    const rating = Number(body.rating ?? 0);
    const reviewText = (body.text ?? "").slice(0, 2000);
    const platform = (body.platform ?? "").trim();
    const reviewerName = (body.reviewer_name ?? "").trim();

    if (!reviewText) {
      return NextResponse.json({ error: "Review text required" }, { status: 400 });
    }

    // Scope to authenticated contractor so the business context comes from
    // their profile (trade, company name).
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, company_name, trade")
      .eq("id", user.id)
      .single();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Dev fallback — same shape as the LLM-drafted response so the UI
      // doesn't branch. Honest: says it's a draft, not a real AI response.
      return NextResponse.json({
        draft: canonicalFallback(rating, reviewerName, profile?.company_name ?? null),
        source: "fallback",
      });
    }

    const system = [
      "You are drafting a public response to a customer review on behalf of a",
      "home-services contractor. Write as the business owner. Keep it under",
      "80 words. Warm, professional, specific, never defensive. Thank positive",
      "reviewers by name; for negative reviews, acknowledge the concern,",
      "offer a direct path to resolution (phone call, email), and do not",
      "dispute facts publicly. Never use emojis.",
    ].join(" ");

    const userPrompt = [
      `Business: ${profile?.company_name ?? "our company"} (${profile?.trade ?? "home services"})`,
      `Platform: ${platform || "review site"}`,
      `Rating: ${rating}/5 stars`,
      `Reviewer: ${reviewerName || "the customer"}`,
      `Review: "${reviewText}"`,
      "",
      "Write the response only — no meta commentary, no sign-off line with placeholders.",
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      console.error("anthropic error:", res.status, errTxt.slice(0, 200));
      return NextResponse.json({
        draft: canonicalFallback(rating, reviewerName, profile?.company_name ?? null),
        source: "fallback_after_error",
      });
    }

    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const draft =
      j.content?.find((c) => c.type === "text")?.text?.trim() ??
      canonicalFallback(rating, reviewerName, profile?.company_name ?? null);

    return NextResponse.json({ draft, source: "claude" });
  } catch (error) {
    logApiError("ai.draftReply", error);
    return NextResponse.json(
      { error: "Failed to draft reply" },
      { status: 500 },
    );
  }
}

function canonicalFallback(rating: number, name: string, company: string | null): string {
  const who = name || "there";
  const biz = company ? ` from ${company}` : "";
  if (rating >= 4) {
    return `Thanks so much${name ? `, ${who}` : ""}! We really appreciate you taking the time to share your experience${biz}. It was a pleasure working with you — please don't hesitate to reach out if we can help with anything else.`;
  }
  if (rating === 3) {
    return `Thank you for the honest feedback${name ? `, ${who}` : ""}. We'd like to understand where we fell short — could you give us a call so we can make it right? Everyone at${biz} takes your experience seriously.`;
  }
  return `${name ? `${who}, ` : ""}we're sorry your experience didn't meet expectations. This isn't the standard${biz} aims for. We'd like to talk through what happened and find a resolution — please contact us directly so we can make it right.`;
}
