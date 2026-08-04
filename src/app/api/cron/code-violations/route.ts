/**
 * GET /api/cron/code-violations
 *
 * Daily cron — pulls major-city code-violation Socrata feeds and
 * upserts into `code_violations` (Wave 2.C, migration 00077).
 *
 * Why this matters: a property cited for failing windows / broken
 * siding / non-permitted work / unsafe wiring needs a contractor.
 * Direct lead, sharper signal than a permit alone (which is just
 * "they're filing for work" — a violation says "they NEED work").
 *
 * Sources (verified-live 2026-05-02):
 *   nyc_dob   data.cityofnewyork.us/resource/3h2n-5cm9.json — DOB violations
 *   chicago   data.cityofchicago.org/resource/22u3-xenr.json — building-code violations
 *   sf        data.sfgov.org/resource/i98e-djp9.json — DBI complaints
 *
 * (LA, Austin, Seattle, NYC HPD all 404'd / timed out on probe and
 * are deferred to a follow-up effort — those need scraper or new
 * Socrata resource IDs.)
 *
 * Window: last 90 days per source. The composite PK absorbs re-runs.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.C of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const PAGE_SIZE = 1000;
const MAX_PAGES = 30; // 30k rows ceiling per source per run

interface SourceSpec {
  jurisdiction: string;
  state: string;
  city: string;
  url: string;
  date_field: string;
  /** Field name containing the upstream id. */
  id_field: string;
  /** Functions to extract canonical fields from the upstream row. */
  extract: (r: Record<string, unknown>) => CanonicalRow;
}

interface CanonicalRow {
  violation_id: string;
  state: string;
  city: string;
  zip: string | null;
  street_address: string | null;
  violation_type: string | null;
  violation_status: string | null;
  issue_date: string | null;
  description: string | null;
  raw_json: Record<string, unknown>;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  // NYC DOB ships dates as YYYYMMDD strings. Other Socrata feeds use ISO.
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const SOURCES: SourceSpec[] = [
  {
    jurisdiction: "nyc_dob",
    state: "NY",
    city: "New York",
    url: "https://data.cityofnewyork.us/resource/3h2n-5cm9.json",
    date_field: "issue_date",
    id_field: "isn_dob_bis_viol",
    extract: (r) => ({
      violation_id: asString(r.isn_dob_bis_viol) ?? "",
      state: "NY",
      city: "New York",
      zip: null, // NYC DOB ships boro/block/lot, not ZIP. Skip.
      street_address: [asString(r.house_number), asString(r.street)].filter(Boolean).join(" ") || null,
      violation_type: asString(r.violation_type),
      violation_status: asString(r.violation_category),
      issue_date: asDate(r.issue_date),
      description: asString(r.description),
      raw_json: r,
    }),
  },
  {
    jurisdiction: "chicago",
    state: "IL",
    city: "Chicago",
    url: "https://data.cityofchicago.org/resource/22u3-xenr.json",
    date_field: "violation_date",
    id_field: "id",
    extract: (r) => ({
      violation_id: asString(r.id) ?? "",
      state: "IL",
      city: "Chicago",
      zip: asString(r.violation_zip_code) ?? asString(r.zip),
      street_address: asString(r.address) ?? asString(r.violation_address),
      violation_type: asString(r.violation_code) ?? asString(r.violation_description),
      violation_status: asString(r.violation_status) ?? asString(r.disposition),
      issue_date: asDate(r.violation_date),
      description: asString(r.violation_description) ?? asString(r.violation_inspector_comments),
      raw_json: r,
    }),
  },
  {
    jurisdiction: "sf",
    state: "CA",
    city: "San Francisco",
    url: "https://data.sfgov.org/resource/i98e-djp9.json",
    date_field: "received_date",
    id_field: "complaint_number",
    extract: (r) => ({
      violation_id: asString(r.complaint_number) ?? "",
      state: "CA",
      city: "San Francisco",
      zip: asString(r.zipcode) ?? asString(r.zip),
      street_address: asString(r.address) ?? asString(r.location),
      violation_type: asString(r.complaint_category) ?? asString(r.complaint_item_type_description),
      violation_status: asString(r.status),
      issue_date: asDate(r.received_date),
      description: asString(r.complaint_description),
      raw_json: r,
    }),
  },
];

async function ingestSource(spec: SourceSpec): Promise<{ pulled: number; inserted: number; pages: number }> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const sep = spec.url.includes("?") ? "&" : "?";
    const url =
      `${spec.url}${sep}$limit=${PAGE_SIZE}&$offset=${offset}` +
      `&$where=${encodeURIComponent(`${spec.date_field} >= '${since}'`)}` +
      `&$order=${encodeURIComponent(`${spec.date_field} DESC`)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      logger.warn("code-violations.fetch_failed", {
        jurisdiction: spec.jurisdiction,
        status: res.status,
        offset,
      });
      break;
    }
    const records = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(records) || records.length === 0) break;

    const rows = records
      .map((r) => {
        const c = spec.extract(r);
        if (!c.violation_id) return null;
        return {
          jurisdiction: spec.jurisdiction,
          ...c,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      const { error, count } = await supabase
        .from("code_violations")
        .upsert(rows, {
          onConflict: "jurisdiction,violation_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) {
        logger.warn("code-violations.insert_error", {
          jurisdiction: spec.jurisdiction,
          page: pages,
          error: error.message,
        });
      } else {
        inserted += count ?? 0;
      }
    }

    pulled += records.length;
    pages += 1;
    offset += records.length;
    if (records.length < PAGE_SIZE) break;
  }

  return { pulled, inserted, pages };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const summary: Record<string, { pulled: number; inserted: number; pages: number }> = {};
  let totalPulled = 0;
  let totalInserted = 0;

  try {
    for (const src of SOURCES) {
      const r = await ingestSource(src);
      summary[src.jurisdiction] = r;
      totalPulled += r.pulled;
      totalInserted += r.inserted;
    }

    logger.info("code-violations.done", {
      duration_ms: Date.now() - startedAt,
      pulled: totalPulled,
      inserted: totalInserted,
      summary,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pulled: totalPulled,
      inserted: totalInserted,
      summary,
    };
    await logCronRun("code-violations", startedAt, {
      pulled: totalPulled, inserted: totalInserted,
      summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("code-violations.error", { error: String(err) });
    await logCronRun("code-violations", startedAt, {
      pulled: totalPulled, inserted: totalInserted,
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "code-violations failed", detail: String(err) },
      { status: 500 },
    );
  }
}
