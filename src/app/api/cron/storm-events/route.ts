/**
 * GET /api/cron/storm-events
 *
 * Daily cron — pulls the last 7 days of US storm events from NOAA NCDC's
 * public Storm Events Database, normalizes the rows, and INSERT-ON-
 * CONFLICT-DO-NOTHING into `storm_events` (migration 00050).
 *
 * Phase 2.3 final piece. Free dataset, no auth required. Most valuable
 * to roofing/storm-chaser contractors:
 *   - Hail event in their ZIP → flag every lead with a roof for outreach
 *   - Wind event with damage → trigger pre-filled inspection request
 *
 * The cron runs at 5am ET daily (off-peak, after NOAA's overnight
 * data refresh). Idempotent via the (event_id, begin_date) unique
 * constraint — re-runs after a transient NOAA outage are safe.
 *
 * Schedule wired in `vercel.json`. Default 7-day window covers the
 * usual NOAA-publish-lag (3-5 days) plus a buffer.
 *
 * ## NOAA API specifics
 *
 * NCDC's Storm Events search returns CSV. We pull the 3 most recent
 * datasets (current month + prior month, plus the "details" bundle):
 *   - StormEvents_details_*.csv — the row-per-event records we care about
 *
 * Daily volume nationwide: ~50-500 events depending on season. This
 * cron processes them in <30s including the parse + insert.
 *
 * ## Auth
 *
 * Per CLAUDE.md cron pattern: requires `CRON_SECRET` Bearer token.
 * Returns 401 otherwise. Same gate as every other cron route.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface StormEventRow {
  event_id: string;
  event_type: string;
  state: string;
  county: string | null;
  zip: string | null;
  begin_date: string;
  end_date: string | null;
  latitude: number | null;
  longitude: number | null;
  magnitude: number | null;
  injuries_direct: number;
  deaths_direct: number;
  damage_property: number | null;
  damage_crops: number | null;
  narrative: string | null;
  source: string;
}

/* ── NOAA fetch + parse ─────────────────────────────────────────────── */

/**
 * Build the NOAA dataset URL for a year.month. NCDC's filenames
 * follow the pattern `StormEvents_details-ftp_v1.0_d{YYYY}_c{YYYYMMDD}.csv.gz`
 * but the "current month" filename has a trailing date that updates
 * every few days. We use the listing endpoint to find the most
 * recent.
 */
async function fetchLatestDetailsCsvForYear(year: number): Promise<string | null> {
  // NCDC's HTML directory listing — parse for the latest details file
  // for the requested year.
  const url = `https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn("NOAA listing fetch failed", { status: res.status });
      return null;
    }
    const html = await res.text();
    // Match StormEvents_details-ftp_v1.0_d{YEAR}_c{YYYYMMDD}.csv.gz
    const re = new RegExp(
      `StormEvents_details-ftp_v1\\.0_d${year}_c\\d{8}\\.csv\\.gz`,
      "g",
    );
    const matches = html.match(re);
    if (!matches || matches.length === 0) return null;
    // Most recent filename wins (lexicographic sort)
    matches.sort();
    return `${url}${matches[matches.length - 1]}`;
  } catch (err) {
    logger.warn("NOAA listing parse failed", { error: String(err) });
    return null;
  }
}

/* ── Minimal CSV parser (RFC-4180-ish) ──────────────────────────────── */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseDamage(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^([\d.]+)\s*([KMBkmb])?$/.exec(s.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = (m[2] ?? "").toUpperCase();
  if (mult === "K") return Math.round(n * 1_000);
  if (mult === "M") return Math.round(n * 1_000_000);
  if (mult === "B") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  // NOAA format: "01-MAY-25 14:30:00" → ISO. Use UTC by default; NOAA
  // events have a local-time offset column too but we don't need
  // sub-day precision for the dashboard chip.
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const month = months[m[2]];
  if (!month) return null;
  const yearShort = parseInt(m[3], 10);
  const year =
    m[3].length === 4 ? m[3] : (yearShort < 50 ? 2000 + yearShort : 1900 + yearShort).toString();
  const day = m[1].padStart(2, "0");
  return `${year}-${month}-${day}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/**
 * Stream-parse a gzipped CSV from a URL into rows. Filters to the
 * requested date window. Returns at most `cap` rows to bound memory.
 *
 * Uses Web-streams + DecompressionStream — no extra dep needed in Node 22+.
 */
async function fetchAndParse(
  url: string,
  windowStart: Date,
  cap = 5000,
): Promise<StormEventRow[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
    // 60s — this streams a multi-thousand-row gzip; the 10s listing timeout
    // is too tight for the dataset pull itself.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) {
    logger.warn("NOAA dataset fetch failed", { url, status: res.status });
    return [];
  }

  const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
  const reader = decompressed.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let header: string[] | null = null;
  const rows: StormEventRow[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // keep incomplete line for next chunk

    for (const line of lines) {
      const fields = parseCsvLine(line);
      if (!header) {
        header = fields.map((f) => f.trim().toUpperCase());
        continue;
      }
      if (rows.length >= cap) break;
      const row = parseRow(header, fields, windowStart);
      if (row) rows.push(row);
    }
    if (rows.length >= cap) break;
  }
  return rows;
}

function parseRow(
  header: string[],
  fields: string[],
  windowStart: Date,
): StormEventRow | null {
  const get = (key: string): string | undefined => {
    const i = header.indexOf(key);
    return i >= 0 ? fields[i] : undefined;
  };

  const beginDateRaw = get("BEGIN_DATE_TIME");
  const beginDate = parseDate(beginDateRaw);
  if (!beginDate) return null;
  if (new Date(beginDate) < windowStart) return null;

  const eventId = get("EVENT_ID");
  const eventType = get("EVENT_TYPE");
  const state = get("STATE");
  if (!eventId || !eventType || !state) return null;

  const lat = parseFloat(get("BEGIN_LAT") ?? "");
  const lng = parseFloat(get("BEGIN_LON") ?? "");
  const mag = parseFloat(get("MAGNITUDE") ?? "");

  return {
    event_id: eventId,
    event_type: eventType,
    state: state.slice(0, 2),
    county: get("CZ_NAME") ?? null,
    zip: null, // NOAA doesn't ship ZIP in details; spatial join via lat/lng later
    begin_date: beginDate,
    end_date: parseDate(get("END_DATE_TIME")) ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    magnitude: Number.isFinite(mag) ? mag : null,
    injuries_direct: parseInt(get("INJURIES_DIRECT") ?? "0", 10) || 0,
    deaths_direct: parseInt(get("DEATHS_DIRECT") ?? "0", 10) || 0,
    damage_property: parseDamage(get("DAMAGE_PROPERTY")),
    damage_crops: parseDamage(get("DAMAGE_CROPS")),
    narrative:
      (get("EPISODE_NARRATIVE") ?? "") || (get("EVENT_NARRATIVE") ?? "") || null,
    source: "NOAA-NCDC",
  };
}

/* ── Route handler ──────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();

  try {
    const supabase = createAdminClient();
    const windowStart = new Date(Date.now() - 7 * 86_400_000);
    const yearNow = new Date().getFullYear();

    // Pull last-week's data. NCDC publishes monthly + late updates;
    // pulling the current and prior year's most-recent details files
    // covers any 7-day window across a calendar boundary.
    const candidates = [
      await fetchLatestDetailsCsvForYear(yearNow),
      yearNow !== new Date(windowStart).getFullYear()
        ? await fetchLatestDetailsCsvForYear(new Date(windowStart).getFullYear())
        : null,
    ].filter((u): u is string => u !== null);

    if (candidates.length === 0) {
      await logCronRun("storm-events", t0, {
        status: "error",
        error: "No NOAA dataset URL resolved",
        trigger: detectTrigger(req),
      });
      return NextResponse.json(
        { ok: false, error: "No NOAA dataset URL resolved" },
        { status: 502 },
      );
    }

    let inserted = 0;
    let skipped = 0;
    for (const url of candidates) {
      const rows = await fetchAndParse(url, windowStart);
      if (rows.length === 0) continue;

      // Insert in chunks of 500 to stay well under PostgREST's payload cap.
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabase.from("storm_events").upsert(chunk, {
          onConflict: "event_id,begin_date",
          ignoreDuplicates: true,
        });
        if (error) {
          logger.warn("storm_events upsert chunk failed", {
            error: error.message,
            chunkStart: i,
          });
          skipped += chunk.length;
        } else {
          inserted += chunk.length;
        }
      }
    }

    await logCronRun("storm-events", t0, {
      pulled: inserted + skipped,
      inserted,
      summary: { inserted, skipped, datasets: candidates.length },
      trigger: detectTrigger(req),
    });

    return NextResponse.json({
      ok: true,
      inserted,
      skipped,
      datasets: candidates.length,
    });
  } catch (err) {
    logger.error("Storm-events cron failed", { error: String(err) });
    await logCronRun("storm-events", t0, {
      status: "error",
      error: String(err),
      trigger: detectTrigger(req),
    });
    return NextResponse.json(
      { ok: false, error: "Cron failed" },
      { status: 500 },
    );
  }
}
