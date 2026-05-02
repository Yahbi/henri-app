/**
 * GET /api/cron/usgs-quakes
 *
 * Daily cron — pulls the last 7 days of US earthquakes (M2.5+) from
 * USGS Earthquake Hazards Program and upserts into `quakes_usgs`
 * (migration 00069). Even mid-magnitude shakes drive chimney /
 * foundation / structural-engineer leads in the affected ZIPs —
 * useful surge signal for those trades.
 *
 * Source: https://earthquake.usgs.gov/fdsnws/event/1/query
 * Free, no auth, public-domain. CONUS-ish bbox.
 *
 * Format: GeoJSON FeatureCollection with stable `id` per event
 * (USGS ComCat). Re-runs idempotent via `event_id` PRIMARY KEY.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const USGS_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";

interface QuakeFeature {
  id?: string;
  properties?: {
    mag?: number;
    place?: string;
    time?: number; // epoch ms
    [k: string]: unknown;
  };
  geometry?: {
    coordinates?: [number, number, number]; // [lng, lat, depth_km]
  };
}

interface QuakeFeed {
  features?: QuakeFeature[];
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  // Last 7 days; M2.5+; CONUS+Alaska bbox per the Python loader.
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString().slice(0, 10),
    endtime: today.toISOString().slice(0, 10),
    minmagnitude: "2.5",
    minlatitude: "18",
    maxlatitude: "72",
    minlongitude: "-180",
    maxlongitude: "-65",
  });

  const url = `${USGS_API}?${params}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      logger.warn("usgs.fetch_failed", { status: res.status });
      return NextResponse.json(
        { error: "USGS fetch failed", status: res.status },
        { status: 502 },
      );
    }
    const json = (await res.json()) as QuakeFeed;
    const feats = json.features ?? [];

    const rows = feats
      .map((f) => {
        const id = f.id;
        const ts = f.properties?.time;
        if (!id || !ts) return null;
        const [lng, lat, depthKm] = f.geometry?.coordinates ?? [];
        return {
          event_id: id,
          event_time: new Date(ts).toISOString(),
          lat: typeof lat === "number" ? lat : null,
          lng: typeof lng === "number" ? lng : null,
          depth_km: typeof depthKm === "number" ? depthKm : null,
          magnitude: f.properties?.mag ?? null,
          place: f.properties?.place ?? null,
          raw_json: f,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    let inserted = 0;
    if (rows.length > 0) {
      const { error, count } = await supabase
        .from("quakes_usgs")
        .upsert(rows, { onConflict: "event_id", count: "exact" });
      if (error) {
        logger.warn("usgs.insert_error", { error: error.message });
        return NextResponse.json(
          { error: "DB insert failed", detail: error.message },
          { status: 500 },
        );
      }
      inserted = count ?? 0;
    }

    logger.info("usgs.done", {
      duration_ms: Date.now() - startedAt,
      pulled: feats.length,
      inserted,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pulled: feats.length,
      inserted,
    };
    await logCronRun("usgs-quakes", startedAt, {
      pulled: feats.length, inserted, summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("usgs.error", { error: String(err) });
    await logCronRun("usgs-quakes", startedAt, {
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "usgs-quakes failed", detail: String(err) },
      { status: 500 },
    );
  }
}
