/**
 * GET /api/cron/swdi-events
 *
 * Daily cron — pulls the last 7 days of NOAA SWDI radar-derived
 * weather signatures and upserts into `weather_swdi_hail`,
 * `weather_swdi_wind`, `weather_swdi_tornado` (migration 00069).
 *
 * Why this exists alongside `/api/cron/storm-events`:
 *   - Storm Events is NOAA's curated, ground-truth event database
 *     with 3-5 day publish lag — high precision but slow.
 *   - SWDI is the radar-derived signature catalog — same-day data,
 *     much higher event volume (~36k hail / 42k wind / 3 tornado per
 *     day in single-day samples). Lower precision but fastest signal
 *     for "did a storm pass over this lead in the last 24 hours."
 *
 * Both feed the lead-scoring storm-impact signal; SWDI gives recency,
 * Storm Events gives confirmed magnitude. Run both for 30 days, then
 * keep both — they answer different scoring questions.
 *
 * Source: https://www.ncei.noaa.gov/swdiws/json/{nx3hail|nx3mda|nx3tvs}/{start}:{end}
 * Free, no auth, public-domain. CONUS coverage.
 *
 * Auth: `CRON_SECRET` Bearer per CLAUDE.md cron pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 280;

const SWDI_BASE = "https://www.ncei.noaa.gov/swdiws/json/";

interface SwdiRecord {
  ZTIME?: string;
  Z_TIME?: string;
  // SWDI returns location as a single WKT field: "POINT (<lng> <lat>)"
  // Older docs also reference LAT/LON which we keep as fallbacks.
  SHAPE?: string;
  LAT?: number | string;
  LON?: number | string;
  // hail-specific
  MAXSIZE?: number | string;
  PROB?: number | string;
  SEVPROB?: number | string;
  // wind-specific
  MAX_WIND?: number | string;
  MAXWIND?: number | string;
  // remaining fields are kept in raw_json
  [k: string]: unknown;
}

/**
 * Parse SWDI SHAPE WKT ("POINT (<lng> <lat>)") into [lng, lat].
 * SWDI ships X/Y in lng/lat order per the WKT spec.
 */
function parseShape(shape: string | undefined): { lat: number; lng: number } | null {
  if (!shape) return null;
  const m = shape.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lat, lng };
}

interface PreparedRow {
  event_time: string;
  lat: number;
  lng: number;
  max_size_mm?: number | null;
  probability?: number | null;
  max_wind_mph?: number | null;
  raw_json: SwdiRecord;
}

/**
 * Convert SWDI's `ZTIME` (e.g. "2026-04-30T18:23:14") to a real ISO
 * UTC string. Some payloads include a trailing "Z", some don't.
 */
function ztimeToIso(t: string): string | null {
  if (!t) return null;
  const trimmed = t.trim();
  const withZ = trimmed.endsWith("Z") ? trimmed : `${trimmed}Z`;
  const d = new Date(withZ);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch one SWDI dataset for the last `days` days. Defaults to a 7-day
 * window because the radar-signature volume can hit hundreds of
 * thousands per month — keep daily ingest small and rely on the
 * unique index for de-dup across re-runs.
 */
async function fetchSwdiDataset(dataset: string, days: number): Promise<SwdiRecord[]> {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - days);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const url = `${SWDI_BASE}${dataset}/${fmt(start)}:${fmt(today)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    logger.warn("SWDI fetch failed", { dataset, status: res.status });
    return [];
  }
  const text = await res.text();
  // SWDI sometimes returns "" on empty windows.
  if (!text.trim()) return [];
  try {
    const json = JSON.parse(text) as { result?: SwdiRecord[] };
    return json.result ?? [];
  } catch (err) {
    logger.warn("SWDI parse failed", { dataset, error: String(err) });
    return [];
  }
}

/** Resolve coordinates from either SHAPE (preferred) or LAT/LON fallbacks. */
function resolveCoords(r: SwdiRecord): { lat: number; lng: number } | null {
  const fromShape = parseShape(r.SHAPE);
  if (fromShape) return fromShape;
  const lat = asNumber(r.LAT);
  const lng = asNumber(r.LON);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function prepareHail(r: SwdiRecord): PreparedRow | null {
  const ts = ztimeToIso(String(r.ZTIME ?? r.Z_TIME ?? ""));
  const coords = resolveCoords(r);
  if (!ts || !coords) return null;
  // MAXSIZE is reported in inches by SWDI — convert to mm to match the
  // canonical schema column name `max_size_mm`. (1 inch = 25.4 mm.)
  const maxSizeIn = asNumber(r.MAXSIZE);
  const maxSizeMm = maxSizeIn != null ? maxSizeIn * 25.4 : null;
  // SEVPROB is the severe-weather probability; PROB is a generic hit
  // probability. Prefer SEVPROB when present; fall back to PROB.
  const probability = asNumber(r.SEVPROB) ?? asNumber(r.PROB);
  return {
    event_time: ts,
    lat: coords.lat,
    lng: coords.lng,
    max_size_mm: maxSizeMm,
    probability,
    raw_json: r,
  };
}

function prepareWind(r: SwdiRecord): PreparedRow | null {
  const ts = ztimeToIso(String(r.ZTIME ?? r.Z_TIME ?? ""));
  const coords = resolveCoords(r);
  if (!ts || !coords) return null;
  return {
    event_time: ts,
    lat: coords.lat,
    lng: coords.lng,
    max_wind_mph: asNumber(r.MAX_WIND) ?? asNumber(r.MAXWIND),
    raw_json: r,
  };
}

function prepareTornado(r: SwdiRecord): PreparedRow | null {
  const ts = ztimeToIso(String(r.ZTIME ?? r.Z_TIME ?? ""));
  const coords = resolveCoords(r);
  if (!ts || !coords) return null;
  return { event_time: ts, lat: coords.lat, lng: coords.lng, raw_json: r };
}

/** Insert in batches of 500 with on-conflict-do-nothing semantics. */
async function batchInsert(
  table: "weather_swdi_hail" | "weather_swdi_wind" | "weather_swdi_tornado",
  rows: PreparedRow[],
  conflictColumns: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createAdminClient();
  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from(table)
      .upsert(slice, { onConflict: conflictColumns, ignoreDuplicates: true, count: "exact" });
    if (error) {
      logger.warn("SWDI insert error", { table, batchStart: i, error: error.message });
      continue;
    }
    inserted += count ?? 0;
  }
  return inserted;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const summary = { hail: 0, wind: 0, tornado: 0, errors: [] as string[] };

  try {
    // 7-day rolling window per dataset. The unique constraint on
    // (event_time, lat, lng) handles de-dup across days.
    const [hail, wind, tornado] = await Promise.all([
      fetchSwdiDataset("nx3hail", 7),
      fetchSwdiDataset("nx3mda", 7),
      fetchSwdiDataset("nx3tvs", 7),
    ]);

    const hailRows = hail.map(prepareHail).filter((r): r is PreparedRow => r !== null);
    const windRows = wind.map(prepareWind).filter((r): r is PreparedRow => r !== null);
    const tornadoRows = tornado.map(prepareTornado).filter((r): r is PreparedRow => r !== null);

    summary.hail = await batchInsert("weather_swdi_hail", hailRows, "event_time,lat,lng");
    summary.wind = await batchInsert("weather_swdi_wind", windRows, "event_time,lat,lng");
    summary.tornado = await batchInsert(
      "weather_swdi_tornado",
      tornadoRows,
      "event_time,lat,lng",
    );

    logger.info("swdi-events.done", {
      duration_ms: Date.now() - startedAt,
      hail_fetched: hail.length,
      wind_fetched: wind.length,
      tornado_fetched: tornado.length,
      ...summary,
    });
    return NextResponse.json({ ok: true, duration_ms: Date.now() - startedAt, ...summary });
  } catch (err) {
    logger.error("swdi-events.error", { error: String(err) });
    return NextResponse.json({ error: "swdi-events failed", detail: String(err) }, { status: 500 });
  }
}
