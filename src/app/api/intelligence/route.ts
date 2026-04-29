import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllTerritoryZips } from "@/lib/territories/fetch-all";

/* ─── GET /api/intelligence — aggregated permit + lead data for ROI Intelligence page ─── */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Get contractor's territories (paginated — PostgREST silently caps
   * unbounded .select() at 1000 rows; founder has 5,601). */
  const zips = await fetchAllTerritoryZips(supabase, user.id, { activeOnly: true });

  if (zips.length === 0) {
    return NextResponse.json({
      summary: null,
      message: "No active territories",
    });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

  /* ── All four analytics queries run in parallel — was 25 s sequential,
   * now roughly max(query duration) ≈ 4-6 s. Also caps the permit pull at
   * 5,000 rows; the aggregations (categories, avg value, hottest ZIPs) are
   * unaffected by beyond-that rows. */
  const lastYearStart = new Date(now.getTime() - 395 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const lastYearEnd = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  // Permit-activity windows use `issued_date` instead of `applied_date`.
  // In our catalog, applied_date is populated for ~1% of rows
  // (Socrata NYC-shape), while issued_date hits ~62% across all
  // sources. Filtering on applied_date dropped this page to near-zero
  // permit activity in 99% of territories. issued_date is the better
  // recency signal for pay-permit / issued-permit data anyway — that's
  // the event a contractor actually cares about.
  const [
    { data: recentPermits, count: recentPermitCount },
    { count: priorPermitCount },
    { data: recentLeads },
    { count: lastYearPermitCount },
  ] = await Promise.all([
    supabase
      .from("permits")
      .select("id, permit_type, estimated_value, issued_date, zip", { count: "exact" })
      .in("zip", zips)
      .gte("issued_date", thirtyDaysAgo.split("T")[0])
      .limit(5000),
    supabase
      .from("permits")
      .select("id", { count: "exact", head: true })
      .in("zip", zips)
      .gte("issued_date", sixtyDaysAgo.split("T")[0])
      .lt("issued_date", thirtyDaysAgo.split("T")[0]),
    supabase
      .from("leads")
      .select(
        "id, status, trade, pipeline_value, permit_value, score, zip, created_at, contacted_at, won_at",
      )
      .eq("contractor_id", user.id)
      .gte("created_at", thirtyDaysAgo)
      .limit(5000),
    supabase
      .from("permits")
      .select("id", { count: "exact", head: true })
      .in("zip", zips)
      .gte("issued_date", lastYearStart)
      .lt("issued_date", lastYearEnd),
  ]);

  const leads = recentLeads ?? [];
  const permits = recentPermits ?? [];

  /* ── Compute aggregations ── */

  /* Permit category breakdown */
  const categoryMap = new Map<string, { count: number; totalValue: number }>();
  for (const p of permits) {
    const cat = p.permit_type ?? "Other";
    const entry = categoryMap.get(cat) ?? { count: 0, totalValue: 0 };
    entry.count += 1;
    entry.totalValue += p.estimated_value ?? 0;
    categoryMap.set(cat, entry);
  }

  const categories = [...categoryMap.entries()]
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count);

  /* Average project value */
  const valuePermits = permits.filter((p) => p.estimated_value && p.estimated_value > 0);
  const avgProjectValue =
    valuePermits.length > 0
      ? valuePermits.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0) / valuePermits.length
      : null;

  /* Territory performance breakdown */
  const zipStats = new Map<
    string,
    { leads: number; contacted: number; won: number; revenue: number }
  >();

  for (const z of zips) {
    zipStats.set(z, { leads: 0, contacted: 0, won: 0, revenue: 0 });
  }

  for (const l of leads) {
    const z = l.zip ?? "";
    const entry = zipStats.get(z) ?? { leads: 0, contacted: 0, won: 0, revenue: 0 };
    entry.leads += 1;
    if (["contacted", "quoted", "proposal", "won"].includes(l.status)) entry.contacted += 1;
    if (l.status === "won") {
      entry.won += 1;
      entry.revenue += l.pipeline_value ?? l.permit_value ?? 0;
    }
    zipStats.set(z, entry);
  }

  const territoryPerformance = [...zipStats.entries()].map(([zip, data]) => ({
    zip,
    ...data,
    contactRate: data.leads > 0 ? Math.round((data.contacted / data.leads) * 100) : 0,
    closeRate: data.contacted > 0 ? Math.round((data.won / data.contacted) * 100) : 0,
  }));

  /* Lead source breakdown */
  const sourceMap = new Map<string, number>();
  for (const l of leads) {
    const src = l.trade ?? "Unknown";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }

  const leadSources = [...sourceMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  /* Hottest ZIPs by permit volume */
  const zipPermitMap = new Map<string, number>();
  for (const p of permits) {
    const z = p.zip ?? "";
    zipPermitMap.set(z, (zipPermitMap.get(z) ?? 0) + 1);
  }

  const hottestZips = [...zipPermitMap.entries()]
    .map(([zip, count]) => ({ zip, permits: count }))
    .sort((a, b) => b.permits - a.permits)
    .slice(0, 5);

  /* Month-over-month change */
  const currentCount = recentPermitCount ?? 0;
  const priorCount = priorPermitCount ?? 0;
  const momChange =
    priorCount > 0 ? Math.round(((currentCount - priorCount) / priorCount) * 100) : null;

  /* Year-over-year change */
  const lastYearCount = lastYearPermitCount ?? 0;
  const yoyChange =
    lastYearCount > 0 ? Math.round(((currentCount - lastYearCount) / lastYearCount) * 100) : null;

  return NextResponse.json(
    {
    period: "Last 30 days",
    territories: zips,
    summary: {
      permitsThisMonth: currentCount,
      permitsLastMonth: priorCount,
      momChange,
      yoyChange,
      avgProjectValue: avgProjectValue ? Math.round(avgProjectValue) : null,
      totalLeads: leads.length,
      leadsWon: leads.filter((l) => l.status === "won").length,
      totalRevenue: leads
        .filter((l) => l.status === "won")
        .reduce((sum, l) => sum + (l.pipeline_value ?? l.permit_value ?? 0), 0),
    },
    categories,
    leadSources,
    territoryPerformance,
    hottestZips,
    },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
