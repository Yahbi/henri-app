import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/overlays/spc
 *
 * Proxies NOAA Storm Prediction Center convective outlooks as GeoJSON.
 * Query: ?day=1|2|3|4-8 (default 1)
 *        ?product=cat|tornado|wind|hail (default cat = categorical)
 *
 * Free, no auth. SPC updates day-1 outlooks several times daily. We cache
 * responses for 30 min — outlook-change cadence is usually 2-6 hours.
 *
 * Data source: https://www.spc.noaa.gov/products/outlook/
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const day = searchParams.get("day") ?? "1";
    const product = searchParams.get("product") ?? "cat";

    // Valid day codes: 1, 2, 3, 4-8 (the multi-day outlook).
    const safeDay = ["1", "2", "3", "4-8"].includes(day) ? day : "1";
    // Valid products: cat (categorical), torn (tornado), wind, hail.
    const safeProduct = ["cat", "torn", "wind", "hail"].includes(product)
      ? product
      : "cat";

    // SPC hosts one GeoJSON per day+product.
    const url = `https://www.spc.noaa.gov/products/outlook/day${safeDay}otlk_${safeProduct}.lyr.geojson`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "Henri App (contractor lead-gen platform)",
      },
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      // SPC returns 404 for day-2/day-3 after midnight before the next
      // cycle's issuance. Return an empty collection so the UI renders
      // cleanly with no outlook instead of an error banner.
      return NextResponse.json(
        { type: "FeatureCollection", features: [] },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }

    const geojson = await res.json();
    return NextResponse.json(geojson, {
      headers: { "Cache-Control": "public, max-age=1800" },
    });
  } catch (err) {
    console.error("spc outlook fetch failed:", err);
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
