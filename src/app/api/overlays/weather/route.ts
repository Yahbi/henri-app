import { NextRequest, NextResponse } from "next/server";

const NWS_API_BASE = "https://api.weather.gov";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const point = searchParams.get("point"); // lat,lng
    const zone = searchParams.get("zone"); // NWS zone ID e.g. "TXZ211"

    const headers: HeadersInit = {
      Accept: "application/geo+json",
      "User-Agent": "(Henri App, contact@henri.app)",
    };

    let alertsUrl: string;

    if (zone) {
      alertsUrl = `${NWS_API_BASE}/alerts/active?zone=${encodeURIComponent(zone)}`;
    } else if (point) {
      const [lat, lng] = point.split(",").map(Number);

      if (isNaN(lat) || isNaN(lng)) {
        return NextResponse.json(
          { error: "Invalid point format. Expected: lat,lng" },
          { status: 400 }
        );
      }

      alertsUrl = `${NWS_API_BASE}/alerts/active?point=${lat},${lng}`;
    } else {
      return NextResponse.json(
        { error: "Either point (lat,lng) or zone parameter is required" },
        { status: 400 }
      );
    }

    const response = await fetch(alertsUrl, {
      headers,
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!response.ok) {
      throw new Error(`NWS API responded with status ${response.status}`);
    }

    const data = await response.json();

    const alerts = (data.features ?? []).map(
      (feature: Record<string, unknown>) => {
        const props = feature.properties as Record<string, unknown>;
        return {
          id: props.id,
          event: props.event,
          severity: props.severity,
          certainty: props.certainty,
          urgency: props.urgency,
          headline: props.headline,
          description: props.description,
          instruction: props.instruction,
          onset: props.onset,
          expires: props.expires,
          sender: props.senderName,
          areas: props.areaDesc,
        };
      }
    );

    return NextResponse.json({ alerts });
  } catch (err) {
    console.error("Error fetching weather alerts:", err);
    return NextResponse.json(
      { error: "Failed to fetch weather alerts" },
      { status: 500 }
    );
  }
}
