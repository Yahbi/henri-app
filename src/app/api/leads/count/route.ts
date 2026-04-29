import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { isGodModeEmail } from "@/lib/auth/god-mode";
import { logApiError } from "@/lib/log";

/**
 * GET /api/leads/count
 *
 * Returns total + geocoded lead counts for the signed-in contractor. Used by
 * the dashboard and map to show "X of Y" transparency so the user knows the
 * app is capping for performance, not missing their data.
 *
 * Cheap — uses HEAD + count=exact so Supabase doesn't return rows.
 * 60-second cache so rapid panel/map nav doesn't hit the DB repeatedly.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    // Strategy: race the exact-count against a 2.5 s deadline. Whoever
    // wins first determines the response.
    //
    // History — 2026-04-26 audit: with 133k+ rows in `leads` and no
    // composite (contractor_id, latitude) partial index, a `count: "exact"`
    // scan was blocking the dashboard sidebar render for 18-25 s
    // before returning. The previous fall-through-on-error path didn't
    // help because a slow-but-successful exact-count still blocked the
    // full duration. Racing against `setTimeout` gives us:
    //   - Cold cache: 2.5 s soft cap, planned-count answer (within ~5-10%)
    //   - Warm cache: exact-count wins (it's typically <500 ms once cached)
    //
    // The transparency hint in the UI is "X of Y" — being off by 5%
    // is an acceptable trade for not having the dashboard sit on a
    // black screen for half a minute. Planned counts are what
    // Supabase's REST default uses for `count: estimated`-style queries
    // anyway; we just make the fallback explicit.
    let total: number | null = null;
    let geocoded: number | null = null;

    // God-mode bypass: founder/dev allowlist sees EVERY lead in the
    // account, not the contractor's claimed slice. Subscription tiers
    // (Founder 3 ZIPs / Starter 5 / Pro 12 / Enterprise 20) still cap
    // regular contractors via `contractor_id`. The bypass exists for
    // pre-launch QA and full-corpus assessments per CLAUDE.md.
    const godMode = isGodModeEmail(user.email);

    const totalQ = supabase.from("leads").select("id", { count: "exact", head: true });
    const geoQ = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not("latitude", "is", null)
      .not("longitude", "is", null);
    if (!godMode) {
      totalQ.eq("contractor_id", user.id);
      geoQ.eq("contractor_id", user.id);
    }

    const exactPromise = Promise.all([totalQ, geoQ]).then(([t, g]) => ({ kind: "exact" as const, t, g }));

    // Sentinel rejection after 2.5 s. The race never throws — we always
    // resolve to either an exact tuple or a "timeout" sentinel.
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ kind: "timeout" }), 2500),
    );

    const winner = await Promise.race([exactPromise, timeoutPromise]);

    if (winner.kind === "exact" && !winner.t.error && !winner.g.error) {
      total = winner.t.count ?? null;
      geocoded = winner.g.count ?? null;
    }

    // Either the exact race lost OR returned an error — fall back to
    // planner estimate. This path always wins fast (~50 ms).
    if (total == null || geocoded == null) {
      const tF = supabase.from("leads").select("id", { count: "planned", head: true });
      const gF = supabase
        .from("leads")
        .select("id", { count: "planned", head: true })
        .not("latitude", "is", null);
      if (!godMode) {
        tF.eq("contractor_id", user.id);
        gF.eq("contractor_id", user.id);
      }
      const [t, g] = await Promise.all([tF, gF]);
      total = t.count ?? null;
      geocoded = g.count ?? null;
    }

    return NextResponse.json(
      {
        total: total ?? 0,
        geocoded: geocoded ?? 0,
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (err) {
    logApiError("leads.count", err);
    return NextResponse.json(
      { error: "Failed to count leads" },
      { status: 500 },
    );
  }
}
