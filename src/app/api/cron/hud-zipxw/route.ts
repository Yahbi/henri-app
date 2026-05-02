/**
 * GET /api/cron/hud-zipxw
 *
 * Quarterly cron — pulls HUD USPS ZIP↔Tract / Place / CBSA / County
 * crosswalks from huduser.gov and upserts into `zip_crosswalk_hud`
 * (~80k ZIPs × 4 geo kinds ≈ 320k rows). Free, public-domain.
 *
 * Why: Henri's territory matching has gaps because ZIP codes don't
 * map cleanly to census tracts / places / counties. The HUD crosswalk
 * gives us authoritative ratios (residential / business / total) so
 * we can correctly attribute a permit to the contractor whose territory
 * actually overlaps.
 *
 * Source format: XLSX (one file per geo kind). We use SheetJS to parse
 * the binary in memory — files are 5-10 MB compressed, fits well
 * inside Vercel's 1024 MB function memory.
 *
 * Update cadence: HUD publishes Q1/Q2/Q3/Q4 quarterly. The latest
 * quarter URL is in QUARTERS below; adjust when HUD rotates.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 2 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const QUARTER = "2024Q4";

/**
 * One source per geo kind. Each XLSX has its own column shape; we
 * normalize at parse time. URLs follow the pattern
 * `huduser.gov/portal/datasets/usps/ZIP_<KIND>_MMYYYY.xlsx`.
 */
const SOURCES: Array<{ kind: "tract" | "place" | "cbsa" | "county"; url: string }> = [
  { kind: "tract",  url: "https://www.huduser.gov/portal/datasets/usps/ZIP_TRACT_122024.xlsx" },
  { kind: "place",  url: "https://www.huduser.gov/portal/datasets/usps/ZIP_PLACE_122024.xlsx" },
  { kind: "cbsa",   url: "https://www.huduser.gov/portal/datasets/usps/ZIP_CBSA_122024.xlsx" },
  { kind: "county", url: "https://www.huduser.gov/portal/datasets/usps/ZIP_COUNTY_122024.xlsx" },
];

interface CrosswalkRow {
  zip: string;
  geoid: string;
  geo_kind: "tract" | "place" | "cbsa" | "county";
  quarter: string;
  res_ratio: number | null;
  bus_ratio: number | null;
  oth_ratio: number | null;
  tot_ratio: number | null;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Pad ZIP to 5 digits — HUD strips leading zeros for some ZIPs. */
function pad5(s: string): string {
  return s.length >= 5 ? s.slice(0, 5) : s.padStart(5, "0");
}

/**
 * Parse one HUD crosswalk XLSX → normalized rows. The geoid column
 * varies by file: TRACT, CITY, CBSA, COUNTY (lowercase variants too).
 */
function parseSheet(
  buf: ArrayBuffer,
  kind: CrosswalkRow["geo_kind"],
): CrosswalkRow[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null,
  });

  const out: CrosswalkRow[] = [];
  for (const row of rows) {
    // Header keys from HUD are typically uppercased: ZIP / TRACT / CITY /
    // CBSA / COUNTY / RES_RATIO / BUS_RATIO / OTH_RATIO / TOT_RATIO. We
    // accept either case.
    const lower = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
    );

    const zipRaw = asString(lower["zip"]);
    if (!zipRaw) continue;
    const zip = pad5(zipRaw);

    const geoidRaw =
      asString(lower["tract"]) ??
      asString(lower["city"]) ??
      asString(lower["cbsa"]) ??
      asString(lower["county"]) ??
      asString(lower["geoid"]);
    if (!geoidRaw) continue;

    out.push({
      zip,
      geoid: geoidRaw,
      geo_kind: kind,
      quarter: QUARTER,
      res_ratio: asNumber(lower["res_ratio"]),
      bus_ratio: asNumber(lower["bus_ratio"]),
      oth_ratio: asNumber(lower["oth_ratio"]),
      tot_ratio: asNumber(lower["tot_ratio"]),
    });
  }
  return out;
}

async function fetchAndIngest(
  url: string,
  kind: CrosswalkRow["geo_kind"],
): Promise<{ pulled: number; inserted: number; ms: number }> {
  const supabase = createAdminClient();
  const startedAt = Date.now();

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
      // HUD blocks default user-agents; spoof a browser shape.
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*;q=0.9",
      Referer: "https://www.huduser.gov/portal/datasets/usps_crosswalk.html",
    },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    logger.warn("hud-zipxw.fetch_failed", { kind, status: res.status });
    return { pulled: 0, inserted: 0, ms: Date.now() - startedAt };
  }
  const buf = await res.arrayBuffer();
  const rows = parseSheet(buf, kind);
  if (rows.length === 0) {
    return { pulled: 0, inserted: 0, ms: Date.now() - startedAt };
  }

  // Batch upsert — Supabase JS client request body limit is ~2 MB; at
  // ~150 bytes/row we stay under by chunking 5k.
  const BATCH = 5000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("zip_crosswalk_hud")
      .upsert(slice, {
        onConflict: "zip,geo_kind,geoid,quarter",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) {
      logger.warn("hud-zipxw.insert_error", {
        kind,
        batchStart: i,
        error: error.message,
      });
      continue;
    }
    inserted += count ?? 0;
  }
  return { pulled: rows.length, inserted, ms: Date.now() - startedAt };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const params = new URL(request.url).searchParams;
  const onlyKind = params.get("kind") as CrosswalkRow["geo_kind"] | null;

  const sources = onlyKind
    ? SOURCES.filter((s) => s.kind === onlyKind)
    : SOURCES;

  const summary: Record<string, { pulled: number; inserted: number; ms: number }> = {};
  let totalPulled = 0;
  let totalInserted = 0;

  try {
    // Process serially to keep memory in check — 4 × 10MB XLSX in
    // parallel risks tripping Vercel's heap ceiling.
    for (const src of sources) {
      const r = await fetchAndIngest(src.url, src.kind);
      summary[src.kind] = r;
      totalPulled += r.pulled;
      totalInserted += r.inserted;
    }

    logger.info("hud-zipxw.done", {
      duration_ms: Date.now() - startedAt,
      quarter: QUARTER,
      pulled: totalPulled,
      inserted: totalInserted,
      summary,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      quarter: QUARTER,
      pulled: totalPulled,
      inserted: totalInserted,
      summary,
    };
    await logCronRun("hud-zipxw", startedAt, {
      pulled: totalPulled, inserted: totalInserted,
      summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("hud-zipxw.error", { error: String(err) });
    await logCronRun("hud-zipxw", startedAt, {
      pulled: totalPulled, inserted: totalInserted,
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "hud-zipxw failed", detail: String(err) },
      { status: 500 },
    );
  }
}
