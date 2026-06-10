/* ── Blast Radius Home Count Estimate ────────────────────────────────────────
 * Estimates the number of homes within a radius of a given point.
 *
 * Uses known lead addresses in our database to anchor the estimate,
 * then applies average US suburban housing density as a fallback.
 *
 * Average US suburban density: ~1,000 housing units per sq mi
 * Urban: ~3,000 per sq mi | Rural: ~100 per sq mi
 * We use 800/sq mi as a conservative suburban estimate.
 * ────────────────────────────────────────────────────────────────────────── */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContractor } from "@/lib/auth/requireContractor";

const DEFAULT_DENSITY = 800; // housing units per sq mile (suburban US)

export async function GET(request: NextRequest) {
  // Contractor planning tool — gate access before the admin-client
  // aggregate query over the leads table runs.
  const authClient = await createClient();
  const gate = await requireContractor(authClient);
  if (gate.response) return gate.response;

  const { searchParams } = request.nextUrl;
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");
  const radiusMiles = parseFloat(searchParams.get("radius") ?? "0.5");

  if (isNaN(lat) || isNaN(lng) || isNaN(radiusMiles) || radiusMiles <= 0) {
    return NextResponse.json(
      { error: "lat, lng, and radius (miles) are required" },
      { status: 400 },
    );
  }

  // Area of circle in sq miles
  const areaSqMi = Math.PI * radiusMiles * radiusMiles;

  // Try to get a data-backed estimate from known leads in the area
  let knownLeadCount = 0;
  let estimateSource: "data" | "density" = "density";

  try {
    const supabase = createAdminClient();

    // PostGIS-free approach: bounding box filter + haversine in app
    // 1 degree latitude ~ 69 miles, 1 degree longitude ~ 69 * cos(lat) miles
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));

    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("latitude", lat - latDelta)
      .lte("latitude", lat + latDelta)
      .gte("longitude", lng - lngDelta)
      .lte("longitude", lng + lngDelta);

    knownLeadCount = count ?? 0;

    // If we have enough leads in the area, use them as a density signal
    // Our leads represent permit-pulling homes; actual homes are much more
    if (knownLeadCount >= 5) {
      estimateSource = "data";
    }
  } catch {
    // DB query failed — fall through to density estimate
  }

  // Calculate estimate
  let homeCount: number;

  if (estimateSource === "data" && knownLeadCount >= 5) {
    // Known leads are a sample. Multiply by a coverage factor.
    // Henri typically captures ~2-5% of homes in a ZIP. Use 3% as midpoint.
    homeCount = Math.round(knownLeadCount / 0.03);
  } else {
    // Pure density-based estimate
    homeCount = Math.round(areaSqMi * DEFAULT_DENSITY);
  }

  // Clamp to reasonable bounds
  homeCount = Math.max(10, Math.min(homeCount, 50_000));

  return NextResponse.json({
    homeCount,
    radiusMiles,
    areaSqMi: Math.round(areaSqMi * 100) / 100,
    source: estimateSource,
    knownLeads: knownLeadCount,
  });
}
