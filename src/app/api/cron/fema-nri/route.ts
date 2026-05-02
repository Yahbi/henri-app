/**
 * GET /api/cron/fema-nri
 *
 * Weekly cron — pulls FEMA National Risk Index (NRI) at county AND
 * census-tract level from the RAPT-hosted ArcGIS FeatureServer
 * (resilience.climate.gov, public, free, commercial-OK). Upserts into
 * `risk_nri_county` (~3,143 rows) and `risk_nri_tract` (~84,000 rows).
 *
 * NRI gives a composite climate / natural-hazard risk score per
 * geography. Henri uses the score to weight permit-storm signals and
 * surface "high-disaster-likelihood ZIPs" inside lead scoring.
 *
 * Source:
 *   https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/
 *     National_Risk_Index_Counties/FeatureServer/0
 *     National_Risk_Index_Census_Tracts/FeatureServer/0
 *
 * Pagination: ArcGIS returns at most ~2000 features per page. We loop
 * via `resultOffset` / `resultRecordCount` until we get a short page.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.A of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const PAGE_SIZE = 2000;

const DATASETS = {
  county:
    "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0",
  tract:
    "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0",
} as const;

interface NriAttrs {
  STCOFIPS?: string;
  TRACTFIPS?: string;
  STATEABBRV?: string;
  STATE?: string;
  COUNTY?: string;
  POPULATION?: number;
  BUILDVALUE?: number;
  AGRIVALUE?: number;
  AREA?: number;
  RISK_SCORE?: number;
  RISK_RATNG?: string;
  RESL_SCORE?: number;
  SOVI_SCORE?: number;
  EAL_VALB?: number;
  EALB_SCORE?: number;
  [k: string]: unknown;
}

interface ArcgisFeature {
  attributes?: NriAttrs;
}

interface ArcgisPage {
  features?: ArcgisFeature[];
  exceededTransferLimit?: boolean;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function buildCountyRow(a: NriAttrs) {
  const fips = asString(a.STCOFIPS);
  if (!fips) return null;
  return {
    county_fips: fips,
    state_abbrv: asString(a.STATEABBRV),
    state_name: asString(a.STATE),
    county_name: asString(a.COUNTY),
    population: asNumber(a.POPULATION),
    building_value: asNumber(a.BUILDVALUE),
    agri_value: asNumber(a.AGRIVALUE),
    area_sq_mi: asNumber(a.AREA),
    risk_score: asNumber(a.RISK_SCORE),
    risk_rating: asString(a.RISK_RATNG),
    resl_score: asNumber(a.RESL_SCORE),
    sovi_score: asNumber(a.SOVI_SCORE),
    ealb_score: asNumber(a.EALB_SCORE) ?? asNumber(a.EAL_VALB),
    raw_json: a,
  };
}

function buildTractRow(a: NriAttrs) {
  const tractFips = asString(a.TRACTFIPS);
  if (!tractFips) return null;
  return {
    tract_fips: tractFips,
    county_fips: tractFips.length >= 5 ? tractFips.slice(0, 5) : null,
    state_abbrv: asString(a.STATEABBRV),
    state_name: asString(a.STATE),
    county_name: asString(a.COUNTY),
    population: asNumber(a.POPULATION),
    building_value: asNumber(a.BUILDVALUE),
    agri_value: asNumber(a.AGRIVALUE),
    area_sq_mi: asNumber(a.AREA),
    risk_score: asNumber(a.RISK_SCORE),
    risk_rating: asString(a.RISK_RATNG),
    resl_score: asNumber(a.RESL_SCORE),
    sovi_score: asNumber(a.SOVI_SCORE),
    ealb_score: asNumber(a.EALB_SCORE) ?? asNumber(a.EAL_VALB),
    raw_json: a,
  };
}

async function fetchAndIngest(
  fsUrl: string,
  table: "risk_nri_county" | "risk_nri_tract",
  buildRow: (a: NriAttrs) => ReturnType<typeof buildCountyRow> | ReturnType<typeof buildTractRow>,
  conflictKey: string,
): Promise<{ pulled: number; inserted: number; pages: number }> {
  const supabase = createAdminClient();
  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 60; // hard ceiling — tract dataset is ~42 pages

  while (pages < MAX_PAGES) {
    const url =
      `${fsUrl}/query?where=1%3D1&outFields=*&f=json` +
      `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      logger.warn("fema-nri.fetch_failed", { table, status: res.status, offset });
      break;
    }
    const json = (await res.json()) as ArcgisPage;
    const feats = json.features ?? [];
    if (feats.length === 0) break;

    const rows = feats
      .map((f) => buildRow(f.attributes ?? {}))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      // ArcGIS FeatureServer sometimes returns a row twice across page
      // boundaries — guard with onConflict so the unique PK absorbs it.
      const { error, count } = await supabase
        .from(table)
        .upsert(rows, { onConflict: conflictKey, count: "exact" });
      if (error) {
        logger.warn("fema-nri.insert_error", { table, page: pages, error: error.message });
      } else {
        inserted += count ?? 0;
      }
    }

    pulled += feats.length;
    pages += 1;
    offset += feats.length;
    if (feats.length < PAGE_SIZE) break;
  }

  return { pulled, inserted, pages };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    // Counties first — small (~3k rows, finishes in ~5s) so we always
    // ship that even if the tract pull times out.
    const county = await fetchAndIngest(
      DATASETS.county,
      "risk_nri_county",
      buildCountyRow,
      "county_fips",
    );

    const tract = await fetchAndIngest(
      DATASETS.tract,
      "risk_nri_tract",
      buildTractRow,
      "tract_fips",
    );

    logger.info("fema-nri.done", {
      duration_ms: Date.now() - startedAt,
      county,
      tract,
    });

    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      county,
      tract,
    };
    await logCronRun("fema-nri", startedAt, {
      pulled: county.pulled + tract.pulled,
      inserted: county.inserted + tract.inserted,
      summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("fema-nri.error", { error: String(err) });
    await logCronRun("fema-nri", startedAt, {
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "fema-nri failed", detail: String(err) },
      { status: 500 },
    );
  }
}
