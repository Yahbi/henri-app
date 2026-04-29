import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bounds = searchParams.get("bounds");
    const zoom = searchParams.get("zoom");

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

    const zoomLevel = zoom ? parseInt(zoom, 10) : 12;

    // Limit results based on zoom level to avoid overwhelming the client
    const limit = zoomLevel >= 15 ? 5000 : zoomLevel >= 12 ? 2000 : 500;

    const supabase = createAdminClient();

    const { data: permits, error } = await supabase.rpc("permits_in_bounds", {
      sw_lng: swLng,
      sw_lat: swLat,
      ne_lng: neLng,
      ne_lat: neLat,
      row_limit: limit,
    });

    if (error) {
      // Fallback: direct query with PostGIS ST_MakeEnvelope
      const { data: fallbackPermits, error: fallbackError } = await supabase
        .from("permits")
        .select("id, latitude, longitude, address, permit_type, status, issued_date, estimated_value")
        .gte("longitude", swLng)
        .lte("longitude", neLng)
        .gte("latitude", swLat)
        .lte("latitude", neLat)
        .limit(limit);

      if (fallbackError) {
        throw new Error(fallbackError.message);
      }

      const features = (fallbackPermits ?? []).map((permit) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [permit.longitude, permit.latitude],
        },
        properties: {
          id: permit.id,
          address: permit.address,
          permit_type: permit.permit_type,
          status: permit.status,
          issued_date: permit.issued_date,
          estimated_value: permit.estimated_value,
        },
      }));

      return NextResponse.json({
        type: "FeatureCollection",
        features,
      });
    }

    const features = (permits ?? []).map((permit: Record<string, unknown>) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [permit.longitude, permit.latitude],
      },
      properties: {
        id: permit.id,
        address: permit.address,
        permit_type: permit.permit_type,
        status: permit.status,
        issued_date: permit.issued_date,
        estimated_value: permit.estimated_value,
      },
    }));

    return NextResponse.json({
      type: "FeatureCollection",
      features,
    });
  } catch (err) {
    logger.error("Error fetching permit overlays", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch permits" },
      { status: 500 }
    );
  }
}
