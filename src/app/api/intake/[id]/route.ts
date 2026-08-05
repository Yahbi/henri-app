import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * GET /api/intake/[id]
 *
 * Returns the homeowner-facing view of a single intake, for the dedicated
 * post-intake project page at `/homeowner/intakes/[id]`. Companion to
 * `/api/intake/[id]/matches` which returns the match list only.
 *
 * Access is scoped to:
 *   - The homeowner whose email is on the intake
 *   - Any contractor that is either the `matched_contractor_id` or listed
 *     in `intake_matches` for this intake
 *
 * No internal scoring factors are exposed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: intakeId } = await params;
    if (!intakeId) {
      return NextResponse.json({ error: "Intake ID is required" }, { status: 400 });
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: intake, error: intakeErr } = await supabase
      .from("homeowner_intakes")
      .select(
        "id, zip, trade, timeline, budget_range, description, refinement_answers, photos, contact_name, contact_phone, contact_email, henri_score, matched_contractor_id, matched_lead_id, status, created_at",
      )
      .eq("id", intakeId)
      .single();

    if (intakeErr || !intake) {
      return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single();

    const isHomeowner =
      profile?.role === "homeowner" && profile?.email === intake.contact_email;

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

    // Redact contact info when the viewer is a contractor who hasn't yet
    // been assigned. Primary contractor sees everything so they can call
    // the homeowner; other matched contractors see masked fields.
    const primaryForViewer =
      isMatchedContractor && intake.matched_contractor_id === user.id;

    const body = {
      id: intake.id,
      zip: intake.zip,
      trade: intake.trade,
      timeline: intake.timeline,
      budget_range: intake.budget_range,
      description: intake.description,
      refinement_answers: intake.refinement_answers ?? [],
      photos: Array.isArray(intake.photos) ? intake.photos : [],
      henri_score: intake.henri_score,
      status: intake.status,
      created_at: intake.created_at,
      matched_contractor_id: intake.matched_contractor_id,
      matched_lead_id: intake.matched_lead_id,
      contact: isHomeowner || primaryForViewer
        ? {
            name: intake.contact_name,
            phone: intake.contact_phone,
            email: intake.contact_email,
          }
        : {
            name: null,
            phone: null,
            email: null,
          },
    };

    return NextResponse.json(body);
  } catch (error) {
    logger.error("Intake detail GET error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/*  PATCH /api/intake/[id]                                                    */
/*                                                                            */
/*  Homeowner-side opt-out / withdraw flow. The only mutation we accept here  */
/*  is { action: "withdraw" } which:                                          */
/*    - sets `status='withdrawn'`                                             */
/*    - clears `consent_given_at` (so the outreach hygiene gate refuses any   */
/*      future SMS / email targeting this intake)                             */
/*                                                                            */
/*  Pairs with Module 4 of the Phase Z sprint (consent capture +              */
/*  withdrawal). The hygiene check in `src/lib/outreach/hygiene.ts` already   */
/*  refuses sends when `consent_given_at IS NULL`, so flipping the column     */
/*  back to null is sufficient — no separate suppression list needed.         */
/* -------------------------------------------------------------------------- */

const PatchSchema = z.object({
  action: z.literal("withdraw"),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: intakeId } = await params;
    if (!intakeId) {
      return NextResponse.json({ error: "Intake ID is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", detail: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Re-fetch the intake to verify ownership before mutating.
    const { data: intake, error: intakeErr } = await supabase
      .from("homeowner_intakes")
      .select("id, status, contact_email")
      .eq("id", intakeId)
      .single();

    if (intakeErr || !intake) {
      return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single();

    const isHomeowner =
      profile?.role === "homeowner" && profile?.email === intake.contact_email;

    if (!isHomeowner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (intake.status === "withdrawn") {
      // Idempotent — re-withdrawing is a no-op success.
      return NextResponse.json({ success: true, status: "withdrawn", already: true });
    }

    /* `.select("id")` is load-bearing, not decoration.
     *
     * With no UPDATE policy on homeowner_intakes, RLS narrows this statement
     * to zero rows: PostgREST returns 204 and supabase-js yields
     * {data:null, error:null}. The old `if (updateErr)` guard never fired, so
     * the route answered `{success:true, status:"withdrawn"}` and the UI told
     * the homeowner their consent was revoked and pending outreach cancelled
     * — while consent_given_at stayed set and the outreach hygiene gate kept
     * returning allowed. Asking for the affected row back makes a missing or
     * regressed policy fail loudly instead of silently.
     *
     * The policy itself ships in migration 00116. */
    const { data: withdrawnRows, error: updateErr } = await supabase
      .from("homeowner_intakes")
      .update({
        status: "withdrawn",
        consent_given_at: null,
      })
      .eq("id", intakeId)
      .select("id");

    if (updateErr) {
      logger.error("Intake withdraw update failed", {
        intakeId,
        error: updateErr.message,
      });
      return NextResponse.json(
        { error: "Failed to withdraw intake" },
        { status: 500 },
      );
    }

    if (!withdrawnRows || withdrawnRows.length === 0) {
      logger.error("Intake withdraw affected zero rows — RLS UPDATE lane missing", {
        intakeId,
        hint: "apply migration 00116_homeowner_write_lanes.sql",
      });
      return NextResponse.json(
        {
          error:
            "Could not withdraw this project. Your consent has NOT been changed — please contact support@meethenri.com.",
        },
        { status: 500 },
      );
    }

    logger.info("Intake withdrawn by homeowner", {
      intakeId,
      previousStatus: intake.status,
    });

    return NextResponse.json({ success: true, status: "withdrawn" });
  } catch (error) {
    logger.error("Intake detail PATCH error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
