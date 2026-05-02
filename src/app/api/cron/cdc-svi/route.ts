/**
 * GET /api/cron/cdc-svi
 *
 * Quarterly cron — pulls the CDC Social Vulnerability Index at the
 * census-tract level from the public Socrata endpoint
 * (data.cdc.gov/resource/ypqf-r5qs.json). ~73,000 tracts. Free, no
 * auth, public-domain.
 *
 * SVI gives a percentile rank (0–1) of social vulnerability per tract,
 * based on 4 themes: socioeconomic, household composition / disability,
 * minority status / language, housing type / transportation. We surface
 * the overall (`rpl_themes`) plus the 4 sub-themes for downstream lead
 * scoring + risk overlays.
 *
 * Pagination: Socrata caps at 1000 rows per request via $limit/$offset.
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

const HOST = "data.cdc.gov";
const DATASET_ID = "ypqf-r5qs";
const PAGE_SIZE = 1000;

interface SviRecord {
  fips?: string;
  st_abbr?: string;
  state?: string;
  county?: string;
  rpl_themes?: string | number;
  rpl_theme1?: string | number;
  rpl_theme2?: string | number;
  rpl_theme3?: string | number;
  rpl_theme4?: string | number;
  e_totpop?: string | number;
  year?: string | number;
  [k: string]: unknown;
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

/** Fallback year — most current Socrata SVI is 2020 vintage as of 2026. */
const FALLBACK_YEAR = 2020;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 100; // 73 expected — soft ceiling

  // Allow caller-side override for back-fills via ?year=2018 etc.
  const reqYear = Number(new URL(request.url).searchParams.get("year"));
  const dataYear = Number.isFinite(reqYear) && reqYear > 0 ? reqYear : FALLBACK_YEAR;

  try {
    while (pages < MAX_PAGES) {
      const url = `https://${HOST}/resource/${DATASET_ID}.json?$limit=${PAGE_SIZE}&$offset=${offset}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        logger.warn("cdc-svi.fetch_failed", { status: res.status, offset });
        break;
      }
      const records = (await res.json()) as SviRecord[];
      if (!Array.isArray(records) || records.length === 0) break;

      const rows = records
        .map((r) => {
          const tractFips = asString(r.fips);
          if (!tractFips) return null;
          return {
            tract_fips: tractFips,
            data_year: asNumber(r.year) ?? dataYear,
            state_abbrv: asString(r.st_abbr) ?? asString(r.state),
            county_name: asString(r.county),
            rpl_themes: asNumber(r.rpl_themes),
            rpl_theme1: asNumber(r.rpl_theme1),
            rpl_theme2: asNumber(r.rpl_theme2),
            rpl_theme3: asNumber(r.rpl_theme3),
            rpl_theme4: asNumber(r.rpl_theme4),
            total_pop: asNumber(r.e_totpop),
            raw_json: r,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("svi_tracts")
          .upsert(rows, { onConflict: "tract_fips,data_year", count: "exact" });
        if (error) {
          logger.warn("cdc-svi.insert_error", { page: pages, error: error.message });
        } else {
          inserted += count ?? 0;
        }
      }

      pulled += records.length;
      pages += 1;
      offset += records.length;
      if (records.length < PAGE_SIZE) break;
    }

    logger.info("cdc-svi.done", {
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
      data_year: dataYear,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
      data_year: dataYear,
    };
    await logCronRun("cdc-svi", startedAt, {
      pulled, inserted, summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("cdc-svi.error", { error: String(err) });
    await logCronRun("cdc-svi", startedAt, {
      pulled, inserted, error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "cdc-svi failed", detail: String(err) },
      { status: 500 },
    );
  }
}
