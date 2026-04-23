import { NextRequest, NextResponse } from "next/server";

const FEMA_FLOOD_API =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bounds = searchParams.get("bounds");

    if (!bounds) {
      return NextResponse.json(
        { error: "bounds parameter is required (sw_lng,sw_lat,ne_lng,ne_lat)" },
        { status: 400 }
      );
    }

    const [swLng, swLat, neLng, neLat] = bounds.split(",").map(Number);

    if ([swLng, swLat, neLng, neLat].some(isNaN)) {
      return NextResponse.json(
        { error: "Invalid bounds format. Expected: sw_lng,sw_lat,ne_lng,ne_lat" },
        { status: 400 }
      );
    }

    const envelope = `${swLng},${swLat},${neLng},${neLat}`;

    const params = new URLSearchParams({
      geometry: envelope,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE",
      returnGeometry: "true",
      f: "geojson",
    });

    const response = await fetch(`${FEMA_FLOOD_API}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      // FEMA's public NFHL endpoint is occasionally 404/503. Fail soft — return
      // an empty FeatureCollection so the map continues to render without the
      // overlay instead of surfacing a 500 to the client.
      console.warn(`FEMA upstream ${response.status}; returning empty overlay`);
      return NextResponse.json(
        { type: "FeatureCollection", features: [] },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }

    const geojson = await response.json();
    return NextResponse.json(geojson);
  } catch (err) {
    console.warn("FEMA fetch error — returning empty overlay:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  }
}
