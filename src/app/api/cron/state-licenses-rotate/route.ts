/**
 * GET /api/cron/state-licenses-rotate
 *
 * Daily cron — pulls one state's contractor license roster per UTC
 * day-of-year, picking the state from `contractor_license_sources`
 * (where enabled = true). Upserts into `state_license_rosters`.
 *
 * Why: closes the wedge-contract bullet about license verification.
 * Today Henri only has CSLB-CA enrichment; this rotator ramps to all
 * 50 states as endpoints get added/verified in the source registry.
 *
 * Strategy:
 *   - Read enabled rows from `contractor_license_sources`
 *   - Pick `enabled[dayOfYear % enabled.length]` for today's run
 *   - Dispatch by `source_kind` (Socrata / ArcGIS / scrape — only the
 *     first two are wired today; scrape Track-B work is Wave 3)
 *   - Apply the row's `field_map` to remap upstream columns to our
 *     canonical schema
 *   - Stamp `last_run_at` + `last_inserted` on the source row
 *
 * Override with `?state=CA` for back-fills.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 2 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

interface SourceRow {
  state_code: string;
  state_name: string;
  source_kind: "socrata" | "arcgis" | "csv" | "scrape";
  endpoint_url: string;
  field_map: Record<string, string>;
  enabled: boolean;
}

interface CanonicalRow {
  state_code: string;
  license_number: string;
  business_name: string | null;
  license_type: string | null;
  license_status: string | null;
  issue_date: string | null;
  expire_date: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  raw_json: Record<string, unknown>;
}

const CANONICAL_COLUMNS: Array<keyof CanonicalRow> = [
  "license_number",
  "business_name",
  "license_type",
  "license_status",
  "issue_date",
  "expire_date",
  "city",
  "state",
  "zip",
  "phone",
  "email",
];

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Dedupe a batch of CanonicalRow by (state_code,license_number).
 * Keeps the LAST occurrence so the most recent endorsement/category
 * row wins (its `raw_json` is then upserted into the row).
 *
 * 2026-05-11 fix: needed because OR Socrata (g77e-6bhs) and AK CSV
 * return one row per endorsement / per program. Within a 1000-row
 * batch, ~24% of rows share a license_number with another row.
 * Postgres's `ON CONFLICT DO UPDATE` errors with "cannot affect row
 * a second time" when the same key appears twice in one statement,
 * which silently caused every OR batch to produce 0 inserts despite
 * pulling 55,715 upstream rows.
 */
function dedupeRowsByPk(rows: CanonicalRow[]): CanonicalRow[] {
  const byKey = new Map<string, CanonicalRow>();
  for (const r of rows) {
    byKey.set(`${r.state_code}|${r.license_number}`, r);
  }
  return [...byKey.values()];
}

/** Apply a `field_map` (canonical → upstream) to one upstream record. */
function mapRecord(
  source: SourceRow,
  upstream: Record<string, unknown>,
): CanonicalRow | null {
  // Allow upstream to use either casing (Socrata is lowercased,
  // ArcGIS is mixed). Build a case-insensitive lookup once.
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(upstream)) {
    lower.set(k.toLowerCase(), v);
  }
  const get = (col: keyof CanonicalRow): unknown => {
    const upstreamCol = source.field_map[col] ?? col;
    return lower.get(upstreamCol.toLowerCase());
  };

  const licenseNumber = asString(get("license_number"));
  if (!licenseNumber) return null;

  const row: CanonicalRow = {
    state_code: source.state_code,
    license_number: licenseNumber,
    business_name: asString(get("business_name")),
    license_type: asString(get("license_type")),
    license_status: asString(get("license_status")),
    issue_date: asDate(get("issue_date")),
    expire_date: asDate(get("expire_date")),
    city: asString(get("city")),
    state: asString(get("state")) ?? source.state_code,
    zip: asString(get("zip")),
    phone: asString(get("phone")),
    email: asString(get("email")),
    raw_json: upstream,
  };
  // Drop rows that have NOTHING but a license number — usually upstream junk.
  const hasAnyData = CANONICAL_COLUMNS.slice(1).some((k) => row[k] != null);
  if (!hasAnyData) return null;
  return row;
}

async function fetchSocrataPage(
  baseUrl: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  // Socrata uses $limit / $offset; CKAN datastore_search uses limit / offset.
  // We support both by appending whichever pattern the URL hasn't already used.
  const isCkan = baseUrl.includes("/api/3/action/datastore_search");
  const sep = baseUrl.includes("?") ? "&" : "?";
  const url = isCkan
    ? `${baseUrl}${sep}limit=${limit}&offset=${offset}`
    : `${baseUrl}${sep}$limit=${limit}&$offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    logger.warn("state-licenses.socrata_fetch_failed", {
      url,
      status: res.status,
    });
    return [];
  }
  const body = await res.json();
  // CKAN wraps under .result.records; Socrata returns the array directly.
  if (isCkan && body?.result?.records && Array.isArray(body.result.records)) {
    return body.result.records as Record<string, unknown>[];
  }
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  return [];
}

/**
 * CSV-source path. The `endpoint_url` may contain `${YYYY-MM-DD}`
 * placeholders that we substitute with today's UTC date (and fall
 * back through the previous 7 days if today's file 404s — common for
 * sources like AZ ROC that publish a dated daily file but skip
 * weekends).
 *
 * Returns a list of upstream records (one per CSV row, header used
 * for keys). Uses a Mozilla User-Agent because some hosts (AZ ROC)
 * block default Node fetch UAs at the Cloudflare edge.
 */
async function fetchCsvSource(
  baseUrl: string,
): Promise<Record<string, unknown>[]> {
  // Try today and the previous 7 UTC days. Stops at the first 200.
  const candidates: string[] = [];
  if (baseUrl.includes("${YYYY-MM-DD}")) {
    const today = new Date();
    for (let back = 0; back < 8; back++) {
      const d = new Date(today.getTime() - back * 86_400_000);
      const ymd = d.toISOString().slice(0, 10);
      candidates.push(baseUrl.replace("${YYYY-MM-DD}", ymd));
    }
  } else {
    candidates.push(baseUrl);
  }

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    Accept: "text/csv,application/octet-stream,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
  };

  let csvText: string | null = null;
  let resolvedUrl: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: browserHeaders,
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        csvText = await res.text();
        resolvedUrl = url;
        break;
      }
    } catch {
      /* try next candidate */
    }
  }
  if (!csvText) {
    logger.warn("state-licenses.csv_fetch_failed", { tried: candidates.length });
    return [];
  }
  logger.info("state-licenses.csv_fetched", {
    url: resolvedUrl,
    bytes: csvText.length,
  });

  // Minimal RFC-4180 parser. Build a streamed line walk so we don't
  // double-allocate when the file is 10–50 MB.
  const out: Record<string, unknown>[] = [];
  let header: string[] | null = null;
  let cur = "";
  let inQuote = false;
  const cells: string[] = [];

  const pushRow = (rawRow: string) => {
    cells.length = 0;
    cur = "";
    inQuote = false;
    for (let i = 0; i < rawRow.length; i++) {
      const c = rawRow[i];
      if (inQuote) {
        if (c === '"' && rawRow[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQuote = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuote = true;
      } else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    if (!header) {
      // Normalize header keys: lowercased, spaces→underscore.
      header = cells.map((h) =>
        h
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, ""),
      );
      return;
    }
    const rec: Record<string, unknown> = {};
    for (let i = 0; i < header.length && i < cells.length; i++) {
      rec[header[i]] = cells[i];
    }
    out.push(rec);
  };

  for (const line of csvText.split(/\r?\n/)) {
    if (line.length === 0) continue;
    pushRow(line);
  }

  return out;
}

async function fetchArcgisPage(
  baseUrl: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${sep}where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=${limit}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    logger.warn("state-licenses.arcgis_fetch_failed", {
      url,
      status: res.status,
    });
    return [];
  }
  const body = (await res.json()) as { features?: Array<{ attributes?: Record<string, unknown> }> };
  return (body.features ?? [])
    .map((f) => f.attributes)
    .filter((a): a is Record<string, unknown> => !!a);
}

async function ingestState(
  source: SourceRow,
): Promise<{ pulled: number; inserted: number; pages: number }> {
  const supabase = createAdminClient();
  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 200; // 200k rows ceiling per state per run

  // CSV-source is single-shot — fetch once, parse the whole file.
  // We pre-load it before the page loop and feed it through the
  // existing batch-upsert path by wrapping it as a single "page".
  if (source.source_kind === "csv") {
    const upstream = await fetchCsvSource(source.endpoint_url);
    if (upstream.length === 0) {
      // Stamp the source row even on no-result so the rotator
      // doesn't immediately re-pick this state on the next run.
      await supabase
        .from("contractor_license_sources")
        .update({
          last_run_at: new Date().toISOString(),
          last_inserted: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("state_code", source.state_code);
      return { pulled: 0, inserted: 0, pages: 0 };
    }
    // Chunk into 1000-row pages and reuse the existing upsert pattern.
    const BATCH = 1000;
    for (let i = 0; i < upstream.length; i += BATCH) {
      const slice = upstream.slice(i, i + BATCH);
      const mapped = slice
        .map((u) => mapRecord(source, u))
        .filter((r): r is CanonicalRow => r !== null);
      // 2026-05-11 fix: dedupe within batch by (state_code,license_number).
      // AK CSV (one row per program per license) hits "cannot affect row a
      // second time" on the upsert without this. See dedupeRowsByPk() for
      // background.
      const rows = dedupeRowsByPk(mapped);
      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("state_license_rosters")
          .upsert(rows, {
            onConflict: "state_code,license_number",
            count: "exact",
          });
        if (error) {
          logger.warn("state-licenses.csv_insert_error", {
            state: source.state_code,
            batchStart: i,
            error: error.message,
          });
        } else {
          inserted += count ?? 0;
        }
      }
      pulled += slice.length;
      pages += 1;
    }
    await supabase
      .from("contractor_license_sources")
      .update({
        last_run_at: new Date().toISOString(),
        last_inserted: inserted,
        updated_at: new Date().toISOString(),
      })
      .eq("state_code", source.state_code);
    return { pulled, inserted, pages };
  }

  while (pages < MAX_PAGES) {
    let upstream: Record<string, unknown>[] = [];
    if (source.source_kind === "socrata") {
      upstream = await fetchSocrataPage(source.endpoint_url, offset, PAGE_SIZE);
    } else if (source.source_kind === "arcgis") {
      upstream = await fetchArcgisPage(source.endpoint_url, offset, PAGE_SIZE);
    } else {
      // 'scrape' kinds belong to Wave 3 Track-B — skip.
      break;
    }
    if (upstream.length === 0) break;

    const mapped = upstream
      .map((u) => mapRecord(source, u))
      .filter((r): r is CanonicalRow => r !== null);
    // 2026-05-11 fix: dedupe within batch by (state_code,license_number).
    // OR Socrata (g77e-6bhs) returns 241 duplicate license_numbers per 1000
    // upstream rows (one row per endorsement). Without dedupe, Postgres errors
    // "cannot affect row a second time" on the upsert and the whole batch
    // silently produces 0 inserts. See dedupeRowsByPk() for background.
    const rows = dedupeRowsByPk(mapped);

    if (rows.length > 0) {
      const { error, count } = await supabase
        .from("state_license_rosters")
        .upsert(rows, {
          onConflict: "state_code,license_number",
          count: "exact",
        });
      if (error) {
        logger.warn("state-licenses.insert_error", {
          state: source.state_code,
          page: pages,
          error: error.message,
        });
      } else {
        inserted += count ?? 0;
      }
    }

    pulled += upstream.length;
    pages += 1;
    offset += upstream.length;
    if (upstream.length < PAGE_SIZE) break;
  }

  // Stamp the source row.
  await supabase
    .from("contractor_license_sources")
    .update({
      last_run_at: new Date().toISOString(),
      last_inserted: inserted,
      updated_at: new Date().toISOString(),
    })
    .eq("state_code", source.state_code);

  return { pulled, inserted, pages };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();
  const params = new URL(request.url).searchParams;
  const stateOverride = (params.get("state") || "").toUpperCase().trim();

  // Pull enabled sources, ordered by last_run_at NULLS FIRST so newly-
  // added states get their first run before old states get a re-run.
  const { data: sources, error: sourcesErr } = await supabase
    .from("contractor_license_sources")
    .select(
      "state_code, state_name, source_kind, endpoint_url, field_map, enabled, last_run_at",
    )
    .eq("enabled", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .returns<SourceRow[]>();
  if (sourcesErr) {
    logger.error("state-licenses.sources_query_failed", {
      error: sourcesErr.message,
    });
    return NextResponse.json(
      { error: "sources query failed", detail: sourcesErr.message },
      { status: 500 },
    );
  }
  if (!sources || sources.length === 0) {
    return NextResponse.json(
      { ok: true, note: "no enabled sources in contractor_license_sources" },
      { status: 200 },
    );
  }

  let target: SourceRow;
  if (stateOverride) {
    const match = sources.find((s) => s.state_code === stateOverride);
    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          error: `state ${stateOverride} is not enabled in contractor_license_sources`,
        },
        { status: 200 },
      );
    }
    target = match;
  } else {
    // The query already orders by last_run_at; just pick the head — the
    // state most overdue for a refresh.
    target = sources[0];
  }

  try {
    const result = await ingestState(target);
    logger.info("state-licenses.done", {
      duration_ms: Date.now() - startedAt,
      state: target.state_code,
      kind: target.source_kind,
      ...result,
    });
    const responseBody = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      state: target.state_code,
      state_name: target.state_name,
      source_kind: target.source_kind,
      ...result,
    };
    await logCronRun("state-licenses-rotate", startedAt, {
      pulled: result.pulled,
      inserted: result.inserted,
      summary: responseBody,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(responseBody);
  } catch (err) {
    logger.error("state-licenses.error", {
      state: target.state_code,
      error: String(err),
    });
    await logCronRun("state-licenses-rotate", startedAt, {
      summary: { state: target.state_code, kind: target.source_kind },
      error: String(err),
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      {
        error: "state-licenses-rotate failed",
        detail: String(err),
        state: target.state_code,
      },
      { status: 500 },
    );
  }
}
