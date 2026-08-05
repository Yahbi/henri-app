/**
 * GET /api/admin/foreclosures-reo
 *
 * God-mode-only. Returns FHA REO foreclosure listings (Wave 1) so
 * the founder can identify pre-listing-prep lead opportunities.
 * REO properties typically need cleanout / repairs / repaints
 * before the lender can resell — high-intent signal for general
 * contractors.
 *
 * Optional query params:
 *   ?state=CA            — filter by state
 *   ?zip=90210           — exact ZIP
 *   ?days=180            — only listings added in the last N days
 *   ?limit=100           — row cap
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGodModeSession } from "@/lib/auth/god-mode";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: { session } } = await supabase.auth.getSession();
  if (!isGodModeSession(user?.email, session?.access_token)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const state = (params.get("state") || "").toUpperCase().trim() || null;
  const zip = (params.get("zip") || "").trim() || null;
  const reqDays = Number(params.get("days"));
  const days = Number.isFinite(reqDays) && reqDays > 0 ? Math.min(3650, reqDays) : 365;
  const reqLimit = Number(params.get("limit"));
  const limit = Number.isFinite(reqLimit) ? Math.min(500, Math.max(1, reqLimit)) : 100;

  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  let q = admin
    .from("foreclosures_fha")
    .select(
      "case_num, street_num, street_name, city, state_code, zip, list_date, list_price",
      { count: "estimated" },
    )
    .gte("list_date", since)
    .order("list_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (state) q = q.eq("state_code", state);
  if (zip) q = q.eq("zip", zip.slice(0, 5));

  const { data, count, error } = await q;
  if (error) {
    logger.error("admin.foreclosures_reo query failed", { message: error.message });
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Group by state for the histogram.
  const byState = new Map<string, number>();
  for (const r of rows) {
    const s = typeof r.state_code === "string" ? r.state_code : null;
    if (s) byState.set(s, (byState.get(s) ?? 0) + 1);
  }

  return NextResponse.json(
    {
      ok: true,
      total_in_window: count ?? rows.length,
      window_days: days,
      listings: rows.map((r) => ({
        case_num: String(r.case_num ?? ""),
        street: [r.street_num, r.street_name].filter(Boolean).join(" "),
        city: typeof r.city === "string" ? r.city : null,
        state: typeof r.state_code === "string" ? r.state_code : null,
        zip: typeof r.zip === "string" ? r.zip : null,
        list_date: typeof r.list_date === "string" ? r.list_date : null,
        list_price: typeof r.list_price === "number" ? r.list_price : null,
      })),
      state_histogram: Object.fromEntries(
        [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
      ),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
