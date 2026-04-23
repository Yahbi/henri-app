import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { PLAN_ZIP_LIMITS } from "@/lib/plans/constants";

/**
 * ZipLock Agent — Territory Exclusivity Manager
 *
 * POST /api/agents/ziplock
 * Body: { action: "check" | "claim" | "release", zip: string, contractor_id: string }
 *
 * Manages ZIP territory exclusivity:
 * - check: Returns whether a ZIP is available or claimed
 * - claim: Claims a ZIP for a contractor (respects plan limits)
 * - release: Releases a ZIP claim
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await requireContractor(supabase);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => ({}));
    const { action, zip, contractor_id } = body;

    if (!action || !zip) {
      return NextResponse.json(
        { status: "error", message: "action and zip are required" },
        { status: 400 },
      );
    }

    // Check current claim status
    if (action === "check") {
      const { data: existing } = await supabase
        .from("territories")
        .select("contractor_id, claimed_at")
        .eq("zip", zip)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({
          status: "ok",
          zip,
          available: true,
          claimed_by: null,
        });
      }

      return NextResponse.json({
        status: "ok",
        zip,
        available: false,
        claimed_by: existing.contractor_id,
        claimed_at: existing.claimed_at,
        is_yours: existing.contractor_id === contractor_id,
      });
    }

    // Claim a ZIP
    if (action === "claim") {
      if (!contractor_id) {
        return NextResponse.json(
          { status: "error", message: "contractor_id is required for claim" },
          { status: 400 },
        );
      }

      // Check if ZIP is already claimed
      const { data: existing } = await supabase
        .from("territories")
        .select("contractor_id")
        .eq("zip", zip)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({
          status: "error",
          message: existing.contractor_id === contractor_id
            ? "You already own this territory"
            : "Territory is claimed by another contractor",
          zip,
          available: false,
        }, { status: 409 });
      }

      // Check plan limits
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", contractor_id)
        .maybeSingle();

      const plan = profile?.plan ?? "starter";
      const maxZips = PLAN_ZIP_LIMITS[plan] ?? 5;

      const { count } = await supabase
        .from("territories")
        .select("*", { count: "exact", head: true })
        .eq("contractor_id", contractor_id);

      if ((count ?? 0) >= maxZips) {
        return NextResponse.json({
          status: "error",
          message: `Plan limit reached (${count}/${maxZips} ZIPs). Upgrade for more territories.`,
          zip,
          current_count: count,
          max_allowed: maxZips,
          plan,
        }, { status: 403 });
      }

      // Claim the territory
      const { error } = await supabase
        .from("territories")
        .insert({
          zip,
          contractor_id,
          claimed_at: new Date().toISOString(),
        });

      if (error) {
        return NextResponse.json(
          { status: "error", message: error.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        status: "ok",
        action: "claimed",
        zip,
        contractor_id,
        remaining_slots: maxZips - ((count ?? 0) + 1),
      });
    }

    // Release a ZIP
    if (action === "release") {
      if (!contractor_id) {
        return NextResponse.json(
          { status: "error", message: "contractor_id is required for release" },
          { status: 400 },
        );
      }

      const { error, count } = await supabase
        .from("territories")
        .delete()
        .eq("zip", zip)
        .eq("contractor_id", contractor_id);

      if (error) {
        return NextResponse.json(
          { status: "error", message: error.message },
          { status: 500 },
        );
      }

      return NextResponse.json({
        status: "ok",
        action: "released",
        zip,
        deleted: (count ?? 0) > 0,
      });
    }

    return NextResponse.json(
      { status: "error", message: `Unknown action: ${action}. Use check, claim, or release.` },
      { status: 400 },
    );
  } catch (err) {
    console.error("[ziplock] Error:", err);
    return NextResponse.json(
      { status: "error", message: "ZipLock operation failed" },
      { status: 500 },
    );
  }
}
