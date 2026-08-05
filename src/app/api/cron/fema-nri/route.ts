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

// 2026-05-11 fix: reduced PAGE_SIZE 2000 → 500 because ArcGIS's
// services.arcgis.com endpoint was returning each 2000-row page
// past the 120s per-fetch budget, killing every cron run with a
// `TimeoutError: The operation was aborted due to timeout`. The
// county dataset (~3k rows) already short-circuits via the count
// gate; the tract dataset is now ~84k rows / 500 per page = 168
// pages, but each fetch returns in ~3-5s so the 280s function
// budget still fits the full tract pull (per-run cap MAX_PAGES=60
// is the new bottleneck — at 60 pages × 500 = 30k rows per run,
// the tract leg completes in 3 runs starting from a fresh DB and
// 1-2 runs once auto-resume kicks in).
const PAGE_SIZE = 500;

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
  startOffset = 0,
): Promise<{ pulled: number; inserted: number; pages: number }> {
  const supabase = createAdminClient();
  let offset = startOffset;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 60; // hard ceiling — tract dataset is ~42 pages

  while (pages < MAX_PAGES) {
    // returnGeometry=false is critical — without it, each NRI feature
    // ships its full county/tract polygon, ballooning the response to
    // ~300MB for 2000 rows and timing out the 120s fetch budget. We
    // only need the attributes (RISK_SCORE, BUILDVALUE, etc.) — no
    // map rendering happens server-side.
    const url =
      `${fsUrl}/query?where=1%3D1&outFields=*&f=json&returnGeometry=false` +
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
      // Chunk to dodge Supabase REST's 8MB body limit (PGRST413).
      // With returnGeometry=false (commit 0b8ce5e) each row is now
      // ~5KB (just attributes, no polygon), so 500 rows × 5KB =
      // 2.5MB stays well under the ceiling. Bigger batches mean
      // fewer round-trips, which matters for tract ingest where
      // 84k rows / 2000 per page = 42 pages — at 5x fewer batches
      // per page (4 not 20) we fit the full tract pull in the
      // 280s function budget.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error, count } = await supabase
          .from(table)
          .upsert(slice, { onConflict: conflictKey, count: "exact" });
        if (error) {
          logger.warn("fema-nri.insert_error", {
            table,
            page: pages,
            batch_start: i,
            error: error.message,
          });
          continue;
        }
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
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const params = new URL(request.url).searchParams;
  const onlyDataset = params.get("dataset"); // 'county' | 'tract' | null
  const explicitOffset = Number(params.get("offset"));

  try {
    const supabase = createAdminClient();

    // Smart resume: if a dataset already has rows, skip pages we've
    // already filled by starting from `count` as the offset. ArcGIS
    // resultOffset is monotonic across the same query, so this works
    // as long as the upstream dataset hasn't been re-ordered. Saves
    // 30-60s of re-fetching dupes per run on large tract pulls.
    //
    // Override paths:
    //   ?dataset=tract     skip the county leg entirely
    //   ?dataset=county    skip the tract leg
    //   ?offset=N          force-start dataset's first leg from N
    let countyStartOffset = 0;
    let tractStartOffset = 0;
    if (Number.isFinite(explicitOffset) && explicitOffset > 0) {
      countyStartOffset = explicitOffset;
      tractStartOffset = explicitOffset;
    } else {
      // Auto-resume from existing row counts. The unique PK absorbs
      // any spillover at the boundary.
      const [countyRes, tractRes] = await Promise.all([
        supabase.from("risk_nri_county").select("*", { count: "estimated", head: true }),
        supabase.from("risk_nri_tract").select("*", { count: "estimated", head: true }),
      ]);
      const countyCount = countyRes.count ?? 0;
      const tractCount = tractRes.count ?? 0;
      // Round down to PAGE_SIZE so we restart at a page boundary.
      // Subtract one page-worth as a safety margin so any boundary
      // dupes get re-checked rather than skipped.
      countyStartOffset = Math.max(0, Math.floor(countyCount / PAGE_SIZE) * PAGE_SIZE - PAGE_SIZE);
      tractStartOffset = Math.max(0, Math.floor(tractCount / PAGE_SIZE) * PAGE_SIZE - PAGE_SIZE);
      // If county is essentially full (3000+ rows), skip its leg
      // entirely so tract gets the full 280s budget.
      if (!onlyDataset && countyCount >= 3000) {
        // Mark the county leg as done by setting offset past the dataset.
        countyStartOffset = 999_999;
      }
    }

    // Counties first (small, ~3k rows). Skipped when ?dataset=tract
    // or when we've auto-detected the table is already full.
    const county = onlyDataset === "tract"
      ? { pulled: 0, inserted: 0, pages: 0 }
      : await fetchAndIngest(
          DATASETS.county,
          "risk_nri_county",
          buildCountyRow,
          "county_fips",
          countyStartOffset,
        );

    const tract = onlyDataset === "county"
      ? { pulled: 0, inserted: 0, pages: 0 }
      : await fetchAndIngest(
          DATASETS.tract,
          "risk_nri_tract",
          buildTractRow,
          "tract_fips",
          tractStartOffset,
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
