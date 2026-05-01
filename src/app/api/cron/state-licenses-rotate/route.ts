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

export const runtime = "nodejs";
export const maxDuration = 280;

interface SourceRow {
  state_code: string;
  state_name: string;
  source_kind: "socrata" | "arcgis" | "scrape";
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

    const rows = upstream
      .map((u) => mapRecord(source, u))
      .filter((r): r is CanonicalRow => r !== null);

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
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      state: target.state_code,
      state_name: target.state_name,
      source_kind: target.source_kind,
      ...result,
    });
  } catch (err) {
    logger.error("state-licenses.error", {
      state: target.state_code,
      error: String(err),
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
