import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * GET /api/overlays/alerts
 *
 * Returns all currently-active NWS alerts nationwide as a GeoJSON
 * FeatureCollection with polygon geometries.
 *
 * Uses the public NWS `api.weather.gov/alerts/active` endpoint. Free, no
 * auth, rate-limit ~60 rpm per User-Agent. Cached 60 s — matches the
 * client-side NWSAlertPolygonLayer refresh cadence.
 *
 * Normalizes the response so the map layer can paint by `severity`
 * (Extreme / Severe / Moderate / Minor / Unknown) without reaching into
 * NWS's verbose property shape.
 */
const NWS_API = "https://api.weather.gov/alerts/active";
const USER_AGENT = "Henri App (contractor lead-gen platform, contact@meethenri.com)";

export async function GET(_request: NextRequest) {
  try {
    const res = await fetch(
      `${NWS_API}?status=actual&message_type=alert,update`,
      {
        headers: {
          Accept: "application/geo+json",
          "User-Agent": USER_AGENT,
        },
        next: { revalidate: 60 },
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [] },
        { status: 200 },
      );
    }

    const data = (await res.json()) as {
      features?: Array<{
        id?: string;
        geometry?: GeoJSON.Geometry | null;
        properties?: Record<string, unknown>;
      }>;
    };

    // Keep only features with actual polygon geometry — many NWS alerts
    // reference zone codes instead of shipping geometry. Those can't be
    // rendered as polygons without joining to the zone dataset, so skip.
    const features = (data.features ?? [])
      .filter((f) => f.geometry && f.geometry.type !== "Point")
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry!,
        properties: {
          id: f.id ?? f.properties?.id,
          event: f.properties?.event,
          severity: f.properties?.severity ?? "Unknown",
          urgency: f.properties?.urgency,
          certainty: f.properties?.certainty,
          headline: f.properties?.headline,
          onset: f.properties?.onset,
          expires: f.properties?.expires,
          areaDesc: f.properties?.areaDesc,
        },
      }));

    return NextResponse.json(
      { type: "FeatureCollection", features },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (err) {
    logger.error("alerts overlay fetch failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { status: 200 },
    );
  }
}
