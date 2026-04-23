import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * POST /api/profile/upgrade-to-contractor
 *
 * Promotes the signed-in homeowner into a contractor so they can enter the
 * contractor onboarding flow without creating a second account. Covers
 * gap-audit item G10 (no UI path for homeowner → contractor). Safe by
 * design:
 *   - Requires an authenticated session.
 *   - Rejects any user whose profile role is not `homeowner` (so a
 *     contractor who already paid can't accidentally reset their state).
 *   - Clears `onboarding_completed` so middleware routes them through
 *     license → plan → payment → territory as if they were a new contractor.
 *
 * No Stripe side-effects — the existing onboarding flow handles billing.
 */
export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: readErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (readErr || !profile) {
      logApiError("profile.upgradeToContractor.read", readErr);
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 },
      );
    }

    if (profile.role !== "homeowner") {
      return NextResponse.json(
        { error: "Only homeowner profiles can upgrade to contractor." },
        { status: 400 },
      );
    }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        role: "contractor",
        onboarding_completed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateErr) {
      logApiError("profile.upgradeToContractor.update", updateErr);
      return NextResponse.json(
        { error: "Unable to upgrade profile." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      redirect: "/onboarding/license",
    });
  } catch (err) {
    logApiError("profile.upgradeToContractor", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
