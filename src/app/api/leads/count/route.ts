import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
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

    // `count: "exact"` does a real COUNT(*) scan. Prior version used
    // `"estimated"` which reads pg_class stats and drifts badly on a
    // heavily-growing table — observed 35k reported vs. 70k actual after
    // a big ingest. That mismatch makes the "X of Y" transparency hint
    // in the UI lie. Exact count takes 2-4 s on 131k rows; cached 5 min
    // client-side + 60 s server-side so fan-out is minimal.
    //
    // Uses `count: "planned"` as a fallback if `"exact"` times out under
    // load — planned is the Postgres planner's estimate (used by EXPLAIN)
    // which is typically tighter than the stats-based "estimated".
    let total: number | null = null;
    let geocoded: number | null = null;
    const [tExact, gExact] = await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("contractor_id", user.id),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("contractor_id", user.id)
        .not("latitude", "is", null)
        .not("longitude", "is", null),
    ]);

    // Supabase returns { count, error } objects — timeouts surface in `.error`
    // without throwing. If either exact-count came back empty or errored,
    // fall back to the planner estimate which reads pg_class stats and is
    // typically within 5–10%. This is what makes the "X of Y" pill on the
    // dashboard recover instead of rendering 0 after a statement timeout.
    const exactFailed =
      !!tExact.error ||
      !!gExact.error ||
      tExact.count == null ||
      gExact.count == null;

    if (exactFailed) {
      const [t, g] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "planned", head: true })
          .eq("contractor_id", user.id),
        supabase
          .from("leads")
          .select("id", { count: "planned", head: true })
          .eq("contractor_id", user.id)
          .not("latitude", "is", null),
      ]);
      total = t.count ?? null;
      geocoded = g.count ?? null;
    } else {
      total = tExact.count ?? null;
      geocoded = gExact.count ?? null;
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
