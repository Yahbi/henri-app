import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { PLAN_ZIP_LIMITS } from "@/lib/plans/constants";
import { ZipLockBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";
import { claimTerritory, releaseTerritory } from "@/lib/territory/ziplock";

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

    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(ZipLockBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { action, zip } = parsed.data;
    /* SECURITY (IDOR): the contractor identity is ALWAYS the authenticated
     * session — never the request body. A body-supplied contractor_id would
     * let a signed-in contractor claim or RELEASE territory on another
     * contractor's behalf (e.g. evicting a rival from their paid ZIP). Any
     * contractor_id in the body is ignored; the discriminated-union schema
     * still accepts the field for backward compatibility but it is not
     * trusted for any authoritative operation. */
    const contractor_id = auth.user.id;

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

      /* A missing/unknown plan must not silently grant Starter's larger
       * allotment — fall back to the smallest paid tier so a contractor whose
       * plan row is absent can't over-claim territory. */
      const plan = profile?.plan ?? "founder";
      const maxZips = PLAN_ZIP_LIMITS[plan] ?? PLAN_ZIP_LIMITS.founder;

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

      // Claim through the RPC, not a direct insert.
      //
      // A raw .insert() here stopped working the moment migration 00129 added
      // the territories_guard_writes trigger, which refuses any writer that
      // is not service_role/postgres/supabase_admin — the guard that closed a
      // paywall bypass where any signed-in user could grant themselves
      // territory straight through PostgREST. This route was the one
      // legitimate caller still writing directly, so it 500'd.
      //
      // Routing through claim_territory is the correct fix rather than a
      // workaround: that RPC is SECURITY DEFINER owned by postgres (so it
      // passes the guard) AND it enforces the subscription check and the
      // per-plan ZIP cap server-side. The plan-cap check above stays as a
      // fast pre-flight that returns a friendlier 403, but it is no longer
      // the only thing standing between a caller and a free territory.
      const claim = await claimTerritory(zip, contractor_id);

      if (!claim.success) {
        return NextResponse.json(
          { status: "error", message: claim.message },
          { status: 409 },
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

      // Release through the RPC — same reason as the claim path above: the
      // 00129 trigger refuses direct DML, and release_territory is SECURITY
      // DEFINER owned by postgres.
      const release = await releaseTerritory(zip, contractor_id);

      if (!release.success) {
        return NextResponse.json(
          { status: "error", message: release.message },
          { status: 409 },
        );
      }

      return NextResponse.json({
        status: "ok",
        action: "released",
        zip,
        // Was `deleted: (count ?? 0) > 0` from the raw .delete()'s row count.
        // release_territory reports its own outcome, and reaching here means
        // it succeeded — the failure branch returned 409 above.
        message: release.message,
      });
    }

    return NextResponse.json(
      { status: "error", message: `Unknown action: ${action}. Use check, claim, or release.` },
      { status: 400 },
    );
  } catch (err) {
    logger.error("[ziplock] Error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { status: "error", message: "ZipLock operation failed" },
      { status: 500 },
    );
  }
}
