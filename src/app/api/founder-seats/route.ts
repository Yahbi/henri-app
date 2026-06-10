import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { logApiError } from "@/lib/log";

/**
 * GET /api/founder-seats
 *
 * Live count of remaining Founder-tier seats. The Founder tier is
 * capped at 100 contractors with the price locked at $149/mo for
 * life — the scarcity claim on the contractors page depends on a
 * truthful live count rather than a hardcoded number.
 *
 * Service-role read (profiles is RLS-gated; this endpoint is a
 * cardinality-only aggregate, no PII leaves). Output cached at the
 * edge for 60s — the count moves slowly enough that staleness is a
 * non-issue, and the cache absorbs landing-page traffic spikes.
 *
 * Graceful-degrade: on any failure we return total=100, taken=null
 * so the UI can render "100 founder seats" without claiming a count
 * we couldn't verify.
 */

const FOUNDER_CAP = 100;

export const revalidate = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Public landing-page endpoint — rate-limit per IP so the admin-client
  // count below can't be hammered anonymously.
  const ip = getClientIp(request);
  const rl = checkRateLimit(`founder-seats:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    // Admin client kept deliberately: profiles is RLS-gated and an anon
    // read isn't verified to permit aggregate counts. This query is
    // count-only (head: true) — no profile rows or PII ever leave.
    const admin = createAdminClient();

    // Count any profile carrying the founder plan slug. We deliberately
    // include in-trial accounts — once the seat is claimed, it counts
    // against the cap regardless of whether Stripe has charged yet.
    const { count, error } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("plan", "founder");

    if (error) {
      logApiError("founder_seats.count", error);
      return NextResponse.json(
        { total: FOUNDER_CAP, taken: null, remaining: null, error: "count_unavailable" },
        { status: 200, headers: { "Cache-Control": "public, max-age=10" } },
      );
    }

    const taken = count ?? 0;
    const remaining = Math.max(0, FOUNDER_CAP - taken);

    return NextResponse.json(
      { total: FOUNDER_CAP, taken, remaining },
      {
        status: 200,
        headers: {
          // 60s edge cache, 30s SWR. Coarse enough that signups feel
          // close to real-time without hammering the DB.
          "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    logApiError("founder_seats.exception", err);
    return NextResponse.json(
      { total: FOUNDER_CAP, taken: null, remaining: null, error: "internal_error" },
      { status: 200 },
    );
  }
}
