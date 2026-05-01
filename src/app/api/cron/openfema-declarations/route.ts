/**
 * GET /api/cron/openfema-declarations
 *
 * Daily cron — pulls FEMA disaster declarations from OpenFEMA v2
 * (DisasterDeclarationsSummaries). ~70k rows historical (since 1953).
 * Free, no auth, public-domain.
 *
 * Why: declared-disaster signals close out a key Henri lead-scoring
 * input — was the lead's county under a major-disaster declaration in
 * the last N days? IA registrations + PA + NFIP claims layer on top
 * later (Wave 2.B Phase 2), but the declarations table itself is the
 * smallest + highest-signal slice.
 *
 * Strategy: re-pull the full set every day (idempotent — `fema_id` is
 * the natural unique key). This is small enough to fit comfortably in
 * a single Vercel function call (~70k rows ÷ 1000/page = 70 pages,
 * each ~200ms).
 *
 * Source:
 *   https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 1 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 280;

const ENDPOINT =
  "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
const PAGE_SIZE = 1000;

interface OpenFemaDecl {
  id?: string;
  disasterNumber?: number | string;
  declarationType?: string;
  declarationDate?: string;
  incidentType?: string;
  declarationTitle?: string;
  state?: string;
  fipsCountyCode?: string;
  placeCode?: string;
  designatedArea?: string;
  incidentBeginDate?: string;
  incidentEndDate?: string;
  [k: string]: unknown;
}

interface OpenFemaPage {
  DisasterDeclarationsSummaries?: OpenFemaDecl[];
  metadata?: { count?: number; top?: number; skip?: number };
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asInt(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function asTimestamp(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildRow(r: OpenFemaDecl) {
  const id = asString(r.id);
  if (!id) return null;
  return {
    fema_id: id,
    disaster_number: asInt(r.disasterNumber),
    declaration_type: asString(r.declarationType),
    declaration_date: asTimestamp(r.declarationDate),
    incident_type: asString(r.incidentType),
    declaration_title: asString(r.declarationTitle),
    state: asString(r.state),
    fips_county_code: asString(r.fipsCountyCode),
    place_code: asString(r.placeCode),
    designated_area: asString(r.designatedArea),
    incident_begin_date: asTimestamp(r.incidentBeginDate),
    incident_end_date: asTimestamp(r.incidentEndDate),
    raw_json: r,
  };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  let skip = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 120; // 70+ expected, soft ceiling

  try {
    while (pages < MAX_PAGES) {
      const url = `${ENDPOINT}?$top=${PAGE_SIZE}&$skip=${skip}&$format=json`;
      let body: OpenFemaPage | null = null;
      // FEMA throttles silently with empty arrays — retry up to 3
      // times with backoff before treating "empty" as "end of data".
      let backoffSec = 2;
      let records: OpenFemaDecl[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          logger.warn("openfema-decl.fetch_failed", {
            status: res.status,
            skip,
            attempt,
          });
          await new Promise((r) => setTimeout(r, backoffSec * 1000));
          backoffSec *= 2;
          continue;
        }
        body = (await res.json()) as OpenFemaPage;
        records = body.DisasterDeclarationsSummaries ?? [];
        if (records.length > 0 || skip === 0) break;
        // Empty mid-pagination → throttle. Back off and retry.
        await new Promise((r) => setTimeout(r, backoffSec * 1000));
        backoffSec *= 2;
      }
      if (records.length === 0) break;

      const rows = records
        .map(buildRow)
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("claims_disasters_fema")
          .upsert(rows, { onConflict: "fema_id", count: "exact" });
        if (error) {
          logger.warn("openfema-decl.insert_error", {
            page: pages,
            error: error.message,
          });
        } else {
          inserted += count ?? 0;
        }
      }

      pulled += records.length;
      pages += 1;
      skip += records.length;
      // Polite inter-page throttle
      if (records.length === PAGE_SIZE) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (records.length < PAGE_SIZE) break;
    }

    logger.info("openfema-decl.done", {
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
    });
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
    });
  } catch (err) {
    logger.error("openfema-decl.error", { error: String(err) });
    return NextResponse.json(
      { error: "openfema-declarations failed", detail: String(err) },
      { status: 500 },
    );
  }
}
