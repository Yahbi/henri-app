import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findMatches, incrementAssignment } from "@/lib/matching/engine";
import { notifyAllMatches } from "@/lib/matching/notify";
import { sendIntakeConfirmation } from "@/lib/resend/intake-confirmation-email";
import type { LeadData } from "@/types/leads";

/* ── Simple in-memory rate limiter (max 5 submissions per IP per hour) ── */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) return false;

  entry.count += 1;
  return true;
}

/* POST /api/intake -- homeowner chat submission -> match -> notify contractor(s) */
export async function POST(req: NextRequest) {
  /* Rate limit by IP */
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": "3600" },
      }
    );
  }

  try {
    const body = await req.json();
    const {
      zip, trade, timeline, budget_range, description,
      refinement_answers, photos, contact_name, contact_phone,
      contact_email, henri_score,
    } = body;

    if (!zip || !trade) {
      return NextResponse.json({ error: "ZIP and trade are required" }, { status: 400 });
    }

    const supabase = await createClient();

    /* ── 1. Run the matching engine ── */
    const matches = await findMatches(supabase, {
      zip,
      trade,
      description,
      budget: parseEstimatedValue(budget_range) ?? undefined,
      urgency: mapTimelineToUrgency(timeline),
    });

    const topMatch = matches[0] ?? null;
    const matchedContractorId = topMatch?.contractorId ?? null;

    /* ── 2. Save homeowner intake ── */
    const { data: intake, error: intakeError } = await supabase
      .from("homeowner_intakes")
      .insert({
        zip,
        trade,
        timeline: timeline ?? null,
        budget_range: budget_range ?? null,
        description: description ?? null,
        refinement_answers: refinement_answers ?? [],
        photos: photos ?? [],
        contact_name: contact_name ?? null,
        contact_phone: contact_phone ?? null,
        contact_email: contact_email ?? null,
        henri_score: henri_score ?? null,
        matched_contractor_id: matchedContractorId,
        status: matches.length > 0 ? "matched" : "pending",
      })
      .select()
      .single();

    if (intakeError) {
      console.error("Intake insert error:", intakeError);
      return NextResponse.json({ error: "Failed to save intake" }, { status: 500 });
    }

    /* ── 3. If matches found, create leads and notify contractors ── */
    let leadId: string | null = null;

    if (matches.length > 0 && matchedContractorId) {
      /* Create a permit stub for the primary match */
      const { data: permit } = await supabase
        .from("permits")
        .insert({
          source_city: "henri_portal",
          source_id: `intake_${intake.id}`,
          permit_type: "residential",
          status: "submitted",
          description: `${trade}: ${description ?? "Homeowner request via Henri portal"}`,
          address: `ZIP ${zip}`,
          city: "Los Angeles",
          state: "CA",
          zip,
          estimated_value: parseEstimatedValue(budget_range),
          applied_date: new Date().toISOString().split("T")[0],
        })
        .select()
        .single();

      if (permit) {
        const urgency =
          (henri_score ?? 70) >= 75 ? "hot" : (henri_score ?? 70) >= 50 ? "warm" : (henri_score ?? 70) >= 25 ? "cool" : "cold";

        /* Score using the new engine for proper sub-scores */
        const { buildSignals, calculateScore } = await import("@/lib/scoring");
        const signals = buildSignals({
          permit: {
            issue_date: new Date().toISOString(),
            estimated_value: parseEstimatedValue(budget_range),
            description: description ?? null,
            permit_type: trade,
            zip,
            created_at: new Date().toISOString(),
          },
          lead: {
            phone: contact_phone ?? null,
            email: contact_email ?? null,
            owner_first: contact_name?.split(" ")[0] ?? null,
            owner_last: contact_name?.split(" ").slice(1).join(" ") ?? null,
            is_homeowner_intake: true,
            permit_description: description ?? null,
            trade,
          },
        });
        const scoreResult = calculateScore(signals);

        /* Create a lead for the primary (top-scoring) contractor */
        const { data: lead } = await supabase
          .from("leads")
          .insert({
            permit_id: permit.id,
            contractor_id: matchedContractorId,
            score: scoreResult.total,
            urgency: scoreResult.urgency,
            status: "new",
            owner_first: contact_name?.split(" ")[0] ?? null,
            owner_last: contact_name?.split(" ").slice(1).join(" ") ?? null,
            phone: contact_phone ?? null,
            email: contact_email ?? null,
            trade,
            zip,
            address: `ZIP ${zip}`,
            is_homeowner_intake: true,
            score_freshness: scoreResult.freshness,
            score_value: scoreResult.value,
            score_contact: scoreResult.contact,
            score_demand: scoreResult.demand,
            notes: scoreResult.factors.length > 0
              ? `Scoring factors: ${scoreResult.factors.join(" | ")}`
              : null,
          })
          .select()
          .single();

        if (lead) {
          leadId = lead.id;
          await supabase
            .from("homeowner_intakes")
            .update({ matched_lead_id: lead.id })
            .eq("id", intake.id);
        }

        /* Track assignments for round-robin fairness */
        for (const match of matches) {
          incrementAssignment(match.contractorId);
        }

        /* ── 4. Save all match results for the /api/intake/[id]/matches endpoint ── */
        const matchRecords = matches.map((m, idx) => ({
          intake_id: intake.id,
          contractor_id: m.contractorId,
          score: m.score,
          factors: m.factors,
          rank: idx + 1,
          is_primary: idx === 0,
        }));

        const { error: matchInsertError } = await supabase
          .from("intake_matches")
          .insert(matchRecords);

        if (matchInsertError) {
          /* Non-fatal: log but continue. The table may not exist yet. */
          console.error("intake_matches insert error (non-fatal):", matchInsertError);
        }

        /* ── 5. Notify all matched contractors (creates quotes + notifications + SMS/email) ── */
        notifyAllMatches(supabase, matches, {
          id: intake.id,
          zip,
          trade,
          description,
          contact_name,
          budget_range,
          henri_score,
        }).catch((err) => console.error("Notification dispatch error:", err));
      }
    }

    /* ── 6. If no matches, queue for manual review ── */
    if (matches.length === 0) {
      const { error: reviewError } = await supabase
        .from("notifications")
        .insert({
          user_id: null,
          type: "manual_review",
          title: `Unmatched intake: ${trade} in ZIP ${zip}`,
          body: `No contractors found for ${trade} work in ZIP ${zip}. Intake ID: ${intake.id}. Requires manual review.`,
          read: false,
          metadata: { intake_id: intake.id },
        });

      if (reviewError) {
        console.error("Manual review notification error:", reviewError);
      }
    }

    /* ── 6.5 Homeowner confirmation email (Phase 1.7) ──
     * Fire-and-forget so a Resend outage doesn't hold up the response.
     * Helper graceful-degrades when `RESEND_API_KEY` is missing, so this
     * is a no-op in local dev without env wiring. */
    if (contact_email) {
      const primaryMatch = matches[0] ?? null;
      const expected = new Date();
      expected.setHours(expected.getHours() + (primaryMatch ? 1 : 24));
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      sendIntakeConfirmation({
        to: contact_email,
        intakeId: intake.id,
        trade,
        zip,
        contractorName: primaryMatch?.companyName ?? null,
        expectedContactLabel: expected.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        }),
        appUrl,
      }).catch((err) => {
        console.error("Intake confirmation email error:", err);
      });
    }

    /* ── 7. Build response ── */
    return NextResponse.json({
      success: true,
      intake_id: intake.id,
      matched: matches.length > 0,
      match_count: matches.length,
      lead_id: leadId,
      contractors: matches.map((m) => ({
        name: m.companyName,
        trade,
        // Honest fields — rating/review_count are null if the contractor
        // hasn't been rated yet. The UI hides rows that are null/zero
        // rather than rendering fake data.
        rating: m.rating > 0 ? m.rating : null,
        review_count: m.reviewCount > 0 ? m.reviewCount : null,
        response_time: m.estimatedResponseTime,
        verified: m.verified,
        jobs_completed: m.jobsCompleted > 0 ? m.jobsCompleted : null,
        years_experience: m.yearsExperience,
        license_state: m.licenseState,
      })),
    });
  } catch (error) {
    console.error("Intake API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ── Parse budget range string to estimated value ── */
function parseEstimatedValue(budgetRange?: string): number | null {
  if (!budgetRange) return null;
  const ranges: Record<string, number> = {
    "Under $5K": 3000,
    "$5K\u2013$15K": 10000,
    "$15K\u2013$50K": 30000,
    "$50K\u2013$100K": 75000,
    "$100K+": 150000,
  };
  return ranges[budgetRange] ?? null;
}

/* ── Map timeline string to urgency enum ── */
function mapTimelineToUrgency(
  timeline?: string
): "asap" | "this_week" | "this_month" | "flexible" | undefined {
  if (!timeline) return undefined;
  const lower = timeline.toLowerCase();
  if (lower.includes("asap") || lower.includes("emergency") || lower.includes("urgent"))
    return "asap";
  if (lower.includes("week")) return "this_week";
  if (lower.includes("month")) return "this_month";
  if (lower.includes("flexible") || lower.includes("no rush")) return "flexible";
  return undefined;
}
