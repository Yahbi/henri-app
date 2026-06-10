import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";

/**
 * GET /api/territories/analytics
 *
 * Returns per-ZIP analytics for each of the authenticated contractor's
 * active territories, plus aggregate stats across all territories.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    /* ── Auth: contractor only ─────────────────────────────────── */
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    /* ── Fetch contractor's active territories ─────────────────── */
    const { data: territories, error: terrError } = await supabase
      .from("territories")
      .select("zip")
      .eq("contractor_id", user.id)
      .eq("status", "active");

    if (terrError) {
      logger.error("Territory fetch error", { error: terrError instanceof Error ? terrError.message : String(terrError) });
      return NextResponse.json(
        { error: "Failed to load territories" },
        { status: 500 }
      );
    }

    const zips = (territories ?? []).map((t) => t.zip as string);

    if (zips.length === 0) {
      return NextResponse.json({
        territories: [],
        aggregate: {
          total_leads: 0,
          total_revenue: 0,
          avg_contact_rate: 0,
          avg_win_rate: 0,
        },
      });
    }

    /* ── Date boundaries ───────────────────────────────────────── */
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const d14 = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    /* ── Fetch all leads for this contractor in the last 30 days ── */
    const { data: leads } = await supabase
      .from("leads")
      .select(
        "id, zip, trade, status, pipeline_value, contacted_at, created_at, won_at"
      )
      .eq("contractor_id", user.id)
      .gte("created_at", d30);

    const allLeads = leads ?? [];

    /* ── Fetch competitor counts per ZIP ───────────────────────── */
    const { data: competitorRows } = await supabase
      .from("territories")
      .select("zip, contractor_id")
      .in("zip", zips)
      .eq("status", "active");

    const competitorMap = new Map<string, number>();
    for (const row of competitorRows ?? []) {
      const z = row.zip as string;
      const current = competitorMap.get(z) ?? 0;
      competitorMap.set(z, current + 1);
    }

    /* ── Fetch permit values for avg_permit_value per ZIP ──────── */
    const { data: permits } = await supabase
      .from("permits")
      .select("zip, estimated_value")
      .in("zip", zips)
      .gte("created_at", d30);

    const permitsByZip = new Map<string, number[]>();
    for (const p of permits ?? []) {
      const z = p.zip as string;
      if (p.estimated_value) {
        const arr = permitsByZip.get(z) ?? [];
        arr.push(Number(p.estimated_value));
        permitsByZip.set(z, arr);
      }
    }

    /* ── Build per-ZIP analytics ──────────────────────────────── */
    const territoryAnalytics = zips.map((zip) => {
      const zipLeads = allLeads.filter((l) => l.zip === zip);
      const leads30d = zipLeads;
      const leads7d = zipLeads.filter(
        (l) => new Date(l.created_at) >= new Date(d7)
      );

      /* Previous 7d (days 8-14 ago) for demand trend */
      const leadsPrev7d = zipLeads.filter((l) => {
        const created = new Date(l.created_at);
        return created >= new Date(d14) && created < new Date(d7);
      });

      /* Contact rate: % contacted within 24h */
      const contactable = leads30d.filter((l) => l.contacted_at);
      const contactedIn24h = contactable.filter((l) => {
        const created = new Date(l.created_at).getTime();
        const contacted = new Date(l.contacted_at!).getTime();
        return contacted - created <= 24 * 3_600_000;
      });
      const contactRate =
        leads30d.length > 0 ? contactedIn24h.length / leads30d.length : 0;

      /* Win rate: won / (won + lost) */
      const won = leads30d.filter((l) => l.status === "won").length;
      const lost = leads30d.filter((l) => l.status === "lost").length;
      const winRate = won + lost > 0 ? won / (won + lost) : 0;

      /* Average response time in hours */
      const responseTimes: number[] = [];
      for (const l of leads30d) {
        if (l.contacted_at) {
          const hours =
            (new Date(l.contacted_at).getTime() -
              new Date(l.created_at).getTime()) /
            3_600_000;
          if (hours >= 0) responseTimes.push(hours);
        }
      }
      const avgResponseH =
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0;

      /* Revenue 30d: sum of pipeline_value for won leads */
      const revenue30d = leads30d
        .filter((l) => l.status === "won" && l.pipeline_value)
        .reduce((sum, l) => sum + Number(l.pipeline_value ?? 0), 0);

      /* Top trade */
      const tradeCounts = new Map<string, number>();
      for (const l of leads30d) {
        if (l.trade) {
          tradeCounts.set(l.trade, (tradeCounts.get(l.trade) ?? 0) + 1);
        }
      }
      let topTrade: string | null = null;
      let topTradeCount = 0;
      for (const [trade, count] of tradeCounts) {
        if (count > topTradeCount) {
          topTrade = trade;
          topTradeCount = count;
        }
      }

      /* Competitor count (subtract self) */
      const totalInZip = competitorMap.get(zip) ?? 1;
      const competitorCount = Math.max(0, totalInZip - 1);

      /* Demand trend: compare last 7d to previous 7d */
      let demandTrend: "rising" | "stable" | "falling" = "stable";
      const count7d = leads7d.length;
      const countPrev7d = leadsPrev7d.length;
      if (countPrev7d === 0 && count7d > 0) {
        demandTrend = "rising";
      } else if (countPrev7d > 0) {
        const change = (count7d - countPrev7d) / countPrev7d;
        if (change >= 0.2) demandTrend = "rising";
        else if (change <= -0.2) demandTrend = "falling";
      }

      /* Avg permit value */
      const permitVals = permitsByZip.get(zip) ?? [];
      const avgPermitValue =
        permitVals.length > 0
          ? permitVals.reduce((a, b) => a + b, 0) / permitVals.length
          : 0;

      return {
        zip,
        lead_count_30d: leads30d.length,
        lead_count_7d: count7d,
        contact_rate: Math.round(contactRate * 1000) / 10,
        win_rate: Math.round(winRate * 1000) / 10,
        avg_response_h: Math.round(avgResponseH * 10) / 10,
        revenue_30d: revenue30d,
        top_trade: topTrade,
        competitor_count: competitorCount,
        demand_trend: demandTrend,
        avg_permit_value: Math.round(avgPermitValue),
      };
    });

    /* ── Aggregate stats ──────────────────────────────────────── */
    const totalLeads = territoryAnalytics.reduce(
      (s, t) => s + t.lead_count_30d,
      0
    );
    const totalRevenue = territoryAnalytics.reduce(
      (s, t) => s + t.revenue_30d,
      0
    );
    const avgContactRate =
      territoryAnalytics.length > 0
        ? territoryAnalytics.reduce((s, t) => s + t.contact_rate, 0) /
          territoryAnalytics.length
        : 0;
    const avgWinRate =
      territoryAnalytics.length > 0
        ? territoryAnalytics.reduce((s, t) => s + t.win_rate, 0) /
          territoryAnalytics.length
        : 0;

    return NextResponse.json(
      {
        territories: territoryAnalytics,
        aggregate: {
          total_leads: totalLeads,
          total_revenue: totalRevenue,
          avg_contact_rate: Math.round(avgContactRate * 10) / 10,
          avg_win_rate: Math.round(avgWinRate * 10) / 10,
        },
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    logger.error("Territory analytics error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Failed to compute territory analytics" },
      { status: 500 }
    );
  }
}
