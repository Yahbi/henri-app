import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { logger } from "@/lib/logger";

const NWS_API_BASE = "https://api.weather.gov";

export async function GET(request: NextRequest) {
  // Dashboard-map overlay — the browser fetches it same-origin with
  // cookies. Require a session + rate-limit per IP so the route can't
  // be used as an anonymous proxy relay to the upstream API.
  const ip = getClientIp(request);
  const rl = checkRateLimit(`overlays.weather:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const point = searchParams.get("point"); // lat,lng
    const zone = searchParams.get("zone"); // NWS zone ID e.g. "TXZ211"

    const headers: HeadersInit = {
      Accept: "application/geo+json",
      "User-Agent": "(Henri App, contact@meethenri.com)",
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
    logger.error("Error fetching weather alerts", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch weather alerts" },
      { status: 500 }
    );
  }
}
