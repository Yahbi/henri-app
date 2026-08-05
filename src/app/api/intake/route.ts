import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatches, incrementAssignment } from "@/lib/matching/engine";
import { notifyAllMatches } from "@/lib/matching/notify";
import { sendIntakeConfirmation } from "@/lib/resend/intake-confirmation-email";
import { logger } from "@/lib/logger";

/* Zod schema — homeowner intake submission. Per the 2026-04-26 audit
 * ([04-api-surface.md F1] + [05-security.md F1]) this route was the
 * highest-risk unvalidated user-input edge in the app: `description`,
 * `trade`, `budget_range`, `timeline` flow into the matching engine and
 * a database insert. Validation is fail-loud — malformed bodies produce
 * a 400 with a structured field list, not a 500.
 *
 * Field rules:
 *   - `zip` must be a US 5-digit string
 *   - `trade` is the canonical trade slug enum
 *   - `description` is bounded at 4000 chars (defense-in-depth against
 *     pathological prompt-injection payloads — see LLM safety in the audit)
 *   - All contact fields are optional (homeowner may submit anonymously)
 *   - `henri_score` is bounded 0–100 to match the scoring engine output */
const IntakeBody = z.object({
  zip: z.string().regex(/^\d{5}$/, "zip must be a 5-digit US ZIP code"),
  trade: z.string().min(1).max(100),
  // `.nullish()` (not `.optional()`) throughout: the chat intake client
  // sends unanswered steps as an explicit `null`, and `.optional()` only
  // widens to `T | undefined` — every submission 400'd on the null.
  timeline: z.string().max(100).nullish(),
  budget_range: z.string().max(100).nullish(),
  description: z.string().max(4000).nullish(),
  refinement_answers: z.array(z.unknown()).nullish(),
  photos: z.array(z.string()).nullish(),
  contact_name: z.string().max(200).nullish(),
  contact_phone: z.string().max(40).nullish(),
  contact_email: z.string().email().max(200).nullish(),
  // Client always posts null here ("let server compute"); the authoritative
  // value is the server-side calculateScore() result written below.
  henri_score: z.number().min(0).max(100).nullish(),
  // Module 5 (2026-05-09) — TCPA-style consent. When true the row gets
  // consent_given_at = NOW(); when false / missing the outreach hygiene
  // gate refuses every send (still creates the in-app notification +
  // quote so the contractor sees the request).
  consent_given: z.boolean().nullish(),
  consent_text_version: z.string().max(40).nullish(),
});

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
    let parsed;
    try {
      parsed = IntakeBody.parse(await req.json());
    } catch (zodErr) {
      const issues = zodErr instanceof z.ZodError ? zodErr.issues : [];
      return NextResponse.json(
        { error: "Invalid intake body", issues },
        { status: 400 },
      );
    }
    /* The schema accepts `null` on every optional field because that is what
     * the chat intake client actually sends for a skipped step. Normalize to
     * `undefined` here so the rest of the handler keeps the single
     * "absent = undefined" convention its helpers and `?? null` defaults are
     * written against — the null-tolerance belongs at the wire boundary, not
     * threaded through the pipeline. */
    const nz = <T,>(v: T | null | undefined): T | undefined => v ?? undefined;

    const zip = parsed.zip;
    const trade = parsed.trade;
    const timeline = nz(parsed.timeline);
    const budget_range = nz(parsed.budget_range);
    const description = nz(parsed.description);
    const refinement_answers = nz(parsed.refinement_answers);
    const photos = nz(parsed.photos);
    const contact_name = nz(parsed.contact_name);
    const contact_phone = nz(parsed.contact_phone);
    const contact_email = nz(parsed.contact_email);
    const henri_score = nz(parsed.henri_score);
    const consent_given = nz(parsed.consent_given);
    const consent_text_version = nz(parsed.consent_text_version);

    // Service-role client (2026-06-10 funnel fix). This endpoint is public
    // by design (anonymous homeowner intake) and is already guarded by the
    // 5/hr/IP rate limit + Zod + consent gating above. Under the caller's
    // RLS the whole pipeline was structurally dead: INSERT..RETURNING on
    // homeowner_intakes failed (no SELECT lane for anon), the matching
    // engine saw zero territories/profiles, and the notifications insert
    // was service-role-only — so EVERY homeowner submission 500'd
    // (verified live). The admin client is the documented pattern for
    // validated public writes (same as /api/reviews).
    const supabase = createAdminClient();

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
    // territory = someone claimed this exact ZIP; proximity = cold-start
    // widen-to-nearest fallback; none = nobody within range.
    const matchType = topMatch?.matchType ?? "none";

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
        // No contractor within range (even after the proximity widen) →
        // 'awaiting_coverage' so ops can see who's waiting on us to expand;
        // the founder also gets the manual-review notification below.
        status: matches.length > 0 ? "matched" : "awaiting_coverage",
        match_type: matchType,
        // Module 5 — only stamp consent timestamps when the homeowner
        // affirmatively checked the box. NULL means "no consent yet"
        // (outreach hygiene gate refuses every send for this intake).
        consent_given_at: consent_given ? new Date().toISOString() : null,
        consent_text_version: consent_given ? (consent_text_version ?? "v1.2026-05-09") : null,
      })
      .select()
      .single();

    if (intakeError) {
      logger.error("Intake insert error", { error: intakeError instanceof Error ? intakeError.message : String(intakeError) });
      return NextResponse.json({ error: "Failed to save intake" }, { status: 500 });
    }

    /* ── 3. If matches found, create leads and notify contractors ── */
    let leadId: string | null = null;
    /* Authoritative score. The client posts `henri_score: null` ("let server
     * compute"), so this — not the request body — is what gets persisted to
     * the intake row and returned to the caller. */
    let computedScore: number | null = null;

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
        /* Score using the new engine for proper sub-scores */
        const { buildSignals, calculateScore } = await import("@/lib/scoring");
        /* Not re-exported from the scoring barrel — import from the module
         * directly, same as the score cron does (cron/score/route.ts:10). */
        const { buildScoreSignalBreakdown } = await import(
          "@/lib/scoring/signals"
        );
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
            // All six components + the breakdown, mirroring the score cron.
            // Without engagement/conversion/signals the drawer rendered the
            // "(legacy score — re-score for full breakdown)" placeholder and
            // showed homeowner_engagement as 0/15 on the warmest lead type
            // in the product — a wedge-contract #2 violation.
            score_engagement: scoreResult.engagement,
            score_conversion: scoreResult.conversion,
            score_signals: buildScoreSignalBreakdown(scoreResult, signals),
            notes: scoreResult.factors.length > 0
              ? `Scoring factors: ${scoreResult.factors.join(" | ")}`
              : null,
          })
          .select()
          .single();

        computedScore = scoreResult.total;

        if (lead) {
          leadId = lead.id;
          await supabase
            .from("homeowner_intakes")
            .update({ matched_lead_id: lead.id, henri_score: scoreResult.total })
            .eq("id", intake.id);
        } else {
          await supabase
            .from("homeowner_intakes")
            .update({ henri_score: scoreResult.total })
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
          logger.error("intake_matches insert error (non-fatal)", { error: matchInsertError instanceof Error ? matchInsertError.message : String(matchInsertError) });
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
        }).catch((err) => logger.error("Notification dispatch error", { error: err instanceof Error ? err.message : String(err) }));

        /* ── 5b. Phase AA — Module 14 alert_rules evaluator ──
         *
         * Fire homeowner_match-eligible rules for every matched
         * contractor. Best-effort try/catch — a thrown error never
         * blocks the intake response. Cross-run dedupe lives inside
         * dispatchAlertHits via last_fired_at. */
        if (leadId) {
          (async () => {
            try {
              const { evaluateRules } = await import("@/lib/alerts/evaluate");
              const { dispatchAlertHits } = await import("@/lib/alerts/dispatch");
              const allHits: Awaited<ReturnType<typeof evaluateRules>> = [];
              for (const m of matches) {
                const { data: rules } = await supabase
                  .from("alert_rules")
                  .select("id, contractor_id, kind, criteria, enabled, channel, last_fired_at, fire_count")
                  .eq("contractor_id", m.contractorId)
                  .eq("enabled", true);
                if (!rules || rules.length === 0) continue;
                const hits = evaluateRules(
                  rules as Parameters<typeof evaluateRules>[0],
                  [
                    {
                      id: leadId,
                      contractor_id: m.contractorId,
                      score: henri_score ?? m.score,
                      trade,
                      zip,
                      address: `ZIP ${zip}`,
                      permit_number: null,
                      permit_description: description ?? null,
                      // Homeowner-submitted intakes default to
                      // homeowner_submitted stage (consent gate may
                      // have set status differently — that's fine for
                      // alerting, the homeowner_match matcher only
                      // checks `is_homeowner_intake`).
                      opportunity_stage: "homeowner_submitted",
                      is_homeowner_intake: true,
                      previous_stage: null,
                    },
                  ],
                );
                allHits.push(...hits);
              }
              if (allHits.length > 0) {
                const summary = await dispatchAlertHits(allHits);
                logger.info("alerts.dispatched_intake", {
                  intakeId: intake.id,
                  hits: allHits.length,
                  ...summary,
                });
              }
            } catch (alertErr) {
              logger.warn("alerts.intake_evaluator_failed", {
                error: alertErr instanceof Error ? alertErr.message : String(alertErr),
              });
            }
          })();
        }
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
        logger.error("Manual review notification error", { error: reviewError instanceof Error ? reviewError.message : String(reviewError) });
      }
    }

    /* ── 6.5 Homeowner confirmation email (Phase 1.7) ──
     * Fire-and-forget so a Resend outage doesn't hold up the response.
     * Helper graceful-degrades when `RESEND_API_KEY` is missing, so this
     * is a no-op in local dev without env wiring. */
    if (contact_email) {
      const primaryMatch = matches[0] ?? null;
      /* Honest label only. `estimatedResponseTime` is
       * responseTimeLabel(profile.response_time_h) from the matching engine
       * and degrades to "response time not yet measured" when we have no
       * history — which we surface as a non-promise rather than a clock. */
      const measured = primaryMatch?.estimatedResponseTime ?? null;
      // null, not a placeholder string — the email template renders a
      // different (non-committal) sentence for null. Passing prose here
      // produced "They'll reach out by a time they'll confirm with you."
      const contactLabel =
        measured && measured !== "response time not yet measured"
          ? measured
          : null;
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      sendIntakeConfirmation({
        to: contact_email,
        intakeId: intake.id,
        trade,
        zip,
        contractorName: primaryMatch?.companyName ?? null,
        expectedContactLabel: contactLabel,
        appUrl,
      }).catch((err) => {
        logger.error("Intake confirmation email error", { error: err instanceof Error ? err.message : String(err) });
      });
    }

    /* ── 7. Build response ── */
    return NextResponse.json({
      success: true,
      intake_id: intake.id,
      matched: matches.length > 0,
      match_count: matches.length,
      lead_id: leadId,
      // Server-computed — the client posts null and reads this back.
      henri_score: computedScore,
      contractors: matches.map((m) => ({
        name: m.companyName,
        trade,
        // Honest fields — rating/review_count are null if the contractor
        // hasn't been rated yet. The UI hides rows that are null/zero
        // rather than rendering fake data.
        rating: m.rating > 0 ? m.rating : null,
        review_count: m.reviewCount > 0 ? m.reviewCount : null,
        response_time: m.estimatedResponseTime,
        /* Was `verified: !!(badge_licensed && badge_insured)` — two columns
         * nothing writes, rendered to the homeowner as "Licensed &
         * Insured". Now the state-roster cross-check, the only licensing
         * check Henri performs. Henri holds no insurance data, so no
         * insured flag is shipped. */
        license_verified: m.licenseVerified,
        jobs_completed: m.jobsCompleted > 0 ? m.jobsCompleted : null,
        years_experience: m.yearsExperience,
        license_state: m.licenseState,
      })),
    });
  } catch (error) {
    logger.error("Intake API error", { error: error instanceof Error ? error.message : String(error) });
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
