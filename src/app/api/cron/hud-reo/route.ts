/**
 * GET /api/cron/hud-reo
 *
 * Daily cron — pulls HUD Single-Family REO (foreclosure) listings
 * from the public ArcGIS FeatureServer and upserts into
 * `foreclosures_fha` (migration 00069). REO listings are a strong
 * pre-listing-prep trigger: someone's about to take possession of
 * a property and almost always needs construction work before
 * resale (cleanouts, repairs, repaints, code-compliance fixes).
 *
 * Source: services.arcgis.com/VTyQ9soqVukalItT/.../SF_REO/0
 * Free public ArcGIS, no auth. ~thousands of records nationwide;
 * cron paginates 1000 at a time.
 *
 * The HUD FeatureServer attribute names are upper-case (`CASE_NUM`,
 * `STREET_NAME`, etc.). We re-key to snake_case to match the
 * canonical schema. The full attribute payload is also kept in
 * `raw_json` for any field we didn't promote.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const FS_URL =
  "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/SF_REO/FeatureServer/0/query";
const PAGE_SIZE = 1000;

interface FeatureRecord {
  attributes?: Record<string, unknown>;
}

interface ArcgisPage {
  features?: FeatureRecord[];
  exceededTransferLimit?: boolean;
}

/** Convert ArcGIS epoch-ms or ISO date to YYYY-MM-DD; returns null on failure. */
function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  const MAX_PAGES = 50;
  let pages = 0;

  try {
    while (pages < MAX_PAGES) {
      const url =
        `${FS_URL}?where=1%3D1&outFields=*&resultOffset=${offset}` +
        `&resultRecordCount=${PAGE_SIZE}&f=json`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        logger.warn("hud-reo.fetch_failed", { status: res.status, offset });
        break;
      }
      const json = (await res.json()) as ArcgisPage;
      const feats = json.features ?? [];
      if (feats.length === 0) break;

      const rows = feats
        .map((feat) => {
          const a = feat.attributes ?? {};
          const caseNum = asString(a.CASE_NUM);
          if (!caseNum) return null; // primary key required
          return {
            case_num: caseNum,
            case_step_number: asString(a.CASE_STEP_NUMBER),
            street_num: asString(a.STREET_NUM),
            street_name: asString(a.STREET_NAME),
            city: asString(a.CITY),
            state_code: asString(a.STATE_CODE),
            zip: asString(a.ZIP),
            census_block: asString(a.CENSUS_BLOCK),
            list_date: toIsoDate(a.LIST_DATE),
            list_price: asNumber(a.LIST_PRICE),
            raw_json: a,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("foreclosures_fha")
          .upsert(rows, { onConflict: "case_num", count: "exact" });
        if (error) {
          logger.warn("hud-reo.insert_error", { error: error.message, offset });
        } else {
          inserted += count ?? 0;
        }
      }

      pulled += feats.length;
      offset += feats.length;
      pages += 1;

      // ArcGIS signals end of result set either by feats < PAGE_SIZE
      // or by an explicit !exceededTransferLimit flag.
      if (feats.length < PAGE_SIZE) break;
      if (json.exceededTransferLimit === false) break;
    }

    logger.info("hud-reo.done", {
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
    };
    await logCronRun("hud-reo", startedAt, {
      pulled, inserted, summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("hud-reo.error", { error: String(err) });
    await logCronRun("hud-reo", startedAt, {
      pulled, inserted, error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json({ error: "hud-reo failed", detail: String(err) }, { status: 500 });
  }
}
