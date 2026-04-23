/* ── Live Permits API ────────────────────────────────────────────────────────
 * GET /api/permits/live
 *
 * Fetches real permit data from Socrata Open Data APIs across multiple US
 * cities. Returns normalized Lead objects with genuine addresses, descriptions,
 * values, and filing dates.
 *
 * Used by the dashboard when Supabase is not configured (demo/preview mode).
 * Results are cached server-side for 5 minutes to avoid hitting Socrata repeatedly.
 * ────────────────────────────────────────────────────────────────────────── */

import { NextRequest, NextResponse } from "next/server";
import { fetchLivePermits } from "@/lib/permits/live";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Gated: only reachable with explicit ?demo=1. The authenticated app must
  // always read from Supabase; this endpoint is retained only for future
  // public-demo use (e.g., marketing landing sandbox), not for regular users.
  if (request.nextUrl.searchParams.get("demo") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Rate limit: 20 requests per minute per IP
  const ip = getClientIp(request);
  const rl = checkRateLimit(`permits-live:${ip}`, { maxRequests: 20 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const leads = await fetchLivePermits();

    return NextResponse.json(leads, {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[/api/permits/live] Failed to fetch live permits:", err);
    return NextResponse.json(
      { error: "Failed to fetch live permit data" },
      { status: 500 },
    );
  }
}
