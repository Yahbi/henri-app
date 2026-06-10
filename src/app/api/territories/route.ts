import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimTerritory } from "@/lib/territory/ziplock";
import { requireContractor } from "@/lib/auth/requireContractor";
import { TerritoryClaimBodySchema, parseBody } from "@/lib/schemas/api";
import { logApiError } from "@/lib/log";
import { fetchAllTerritories } from "@/lib/territories/fetch-all";
import { PLAN_ZIP_LIMITS } from "@/lib/plans/constants";
import { isGodModeEmail } from "@/lib/auth/god-mode";

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    // PostgREST caps single-response selects at 1000 rows — use the
    // shared paginator so the founder's 5,601 claimed ZIPs don't get
    // silently truncated here.
    type Row = { id: string; contractor_id: string; zip: string; status: string; slot_number: number | null; claimed_at: string; created_at: string };
    const territories = await fetchAllTerritories<Row>(
      supabase,
      user.id,
      "id, contractor_id, zip, status, slot_number, claimed_at, created_at",
      { activeOnly: true, orderBy: { column: "claimed_at", ascending: false } },
    );

    return NextResponse.json(
      { territories },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logApiError("territories.list", err);
    return NextResponse.json(
      { error: "Failed to list territories" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const raw = await request.json();
    const parsed = parseBody(TerritoryClaimBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { zip } = parsed.data;

    // Audit G2 fix (2026-04-27): enforce per-plan ZIP cap before
    // calling claim_territory(). The PG function only checks per-ZIP
    // slot availability — NOT per-contractor plan caps. Without this
    // gate a Founder ($149/mo, 3 ZIPs declared on the pricing page)
    // could claim 50 ZIPs through this endpoint and silently get
    // Pro-tier coverage. God-mode users (founder/dev allowlist) skip
    // the cap so they can preview the full corpus.
    if (!isGodModeEmail(user.email)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan, stripe_subscription_id")
        .eq("id", user.id)
        .maybeSingle();

      // Payment gate (2026-06-10 audit): `stripe_customer_id` is stamped
      // when a checkout SESSION is created — before any payment — so it
      // proved nothing. `stripe_subscription_id` is written only by the
      // `checkout.session.completed` webhook, i.e. after Stripe actually
      // started the subscription (incl. the 24h trial). Without this, a
      // user who cancelled at the Stripe page could claim territories and
      // use the dashboard with a self-asserted plan and no card on file.
      if (!profile?.stripe_subscription_id) {
        return NextResponse.json(
          {
            error: "payment_required",
            message:
              "Start your free trial to claim territories — complete checkout first.",
          },
          { status: 402 },
        );
      }

      const plan = profile?.plan ?? "starter";
      const maxZips = PLAN_ZIP_LIMITS[plan] ?? 5;

      const { count } = await supabase
        .from("territories")
        .select("*", { count: "exact", head: true })
        .eq("contractor_id", user.id);

      if ((count ?? 0) >= maxZips) {
        return NextResponse.json(
          {
            error: `Plan limit reached (${count}/${maxZips} ZIPs). Upgrade for more territories.`,
            current_count: count,
            max_allowed: maxZips,
            plan,
          },
          { status: 403 },
        );
      }
    }

    const result = await claimTerritory(zip, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 409 }
      );
    }

    return NextResponse.json({ message: result.message }, { status: 201 });
  } catch (err) {
    logApiError("territories.claim", err);
    return NextResponse.json(
      { error: "Failed to claim territory" },
      { status: 500 }
    );
  }
}
