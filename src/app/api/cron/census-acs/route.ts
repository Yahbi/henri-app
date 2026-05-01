/**
 * GET /api/cron/census-acs
 *
 * Quarterly cron — pulls Census ACS 5-year housing/demo variables at
 * the ZCTA (ZIP-code tabulation area) level from the public Census API
 * (api.census.gov/data/{year}/acs/acs5). Free, no auth, public-domain.
 *
 * 7 variables × ~33,000 ZCTAs ≈ 230k rows. Long-format storage so we
 * can extend the variable list without touching the schema.
 *
 * Variables (B-series detailed tables):
 *   B01003_001E  Total population
 *   B25001_001E  Total housing units
 *   B25002_002E  Occupied housing units
 *   B25002_003E  Vacant housing units
 *   B25077_001E  Median home value
 *   B25064_001E  Median gross rent
 *   B19013_001E  Median household income
 *
 * One HTTP request per variable returns the entire ZCTA list — there
 * is no `&for=` paging API for ZCTA. Each response is ~2 MB JSON.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.A of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 280;

const VARS = [
  "B01003_001E",
  "B25001_001E",
  "B25002_002E",
  "B25002_003E",
  "B25077_001E",
  "B25064_001E",
  "B19013_001E",
] as const;

const SURVEY_YEAR = 2023; // latest released ACS 5-year as of 2026-04-30

const BASE = `https://api.census.gov/data/${SURVEY_YEAR}/acs/acs5`;

interface AcsRow {
  zcta5: string;
  variable_code: string;
  value: number | null;
  survey_year: number;
}

/**
 * Census ACS returns a 2-D array: header row, then data rows.
 * Header is e.g.: ["NAME", "B01003_001E", "zip code tabulation area"]
 * Data row: ["ZCTA5 90210", "21662", "90210"]
 *
 * The variable value is sometimes the literal string "null" or
 * negative sentinel codes (-666666666, -999999999) for "no data".
 * We normalize both to null.
 */
function parseAcsResponse(body: unknown, variable: string): AcsRow[] {
  if (!Array.isArray(body) || body.length < 2) return [];
  const out: AcsRow[] = [];
  // Skip header row at index 0
  for (let i = 1; i < body.length; i++) {
    const row = body[i];
    if (!Array.isArray(row) || row.length < 3) continue;
    const rawValue = row[1];
    const zcta = String(row[2] ?? "").trim();
    if (!zcta || zcta.length !== 5) continue;
    let value: number | null = null;
    if (rawValue != null && rawValue !== "null") {
      const n = Number(rawValue);
      // Census negative sentinels mean "missing" — drop them.
      if (Number.isFinite(n) && n > -100_000_000) value = n;
    }
    out.push({
      zcta5: zcta,
      variable_code: variable,
      value,
      survey_year: SURVEY_YEAR,
    });
  }
  return out;
}

async function fetchVariable(variable: string): Promise<AcsRow[]> {
  const url = `${BASE}?get=NAME,${variable}&for=zip%20code%20tabulation%20area:*`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    logger.warn("census-acs.fetch_failed", { variable, status: res.status });
    return [];
  }
  const body = (await res.json()) as unknown;
  return parseAcsResponse(body, variable);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  const perVar: Record<string, { pulled: number; inserted: number }> = {};
  let totalPulled = 0;
  let totalInserted = 0;

  try {
    // Run variables sequentially — Census API hates parallelism and
    // the response objects are 2 MB each (would balloon memory on
    // Vercel's small node.js function instance).
    for (const v of VARS) {
      const rows = await fetchVariable(v);
      perVar[v] = { pulled: rows.length, inserted: 0 };
      totalPulled += rows.length;
      if (rows.length === 0) continue;

      // Batch upsert — Supabase JS client handles thousands of rows per
      // call but stays under the 2 MB request body limit by chunking.
      const BATCH = 2000;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error, count } = await supabase
          .from("demo_acs_zcta")
          .upsert(slice, {
            onConflict: "zcta5,variable_code,survey_year",
            count: "exact",
          });
        if (error) {
          logger.warn("census-acs.insert_error", {
            variable: v,
            batchStart: i,
            error: error.message,
          });
          continue;
        }
        perVar[v].inserted += count ?? 0;
        totalInserted += count ?? 0;
      }
    }

    logger.info("census-acs.done", {
      duration_ms: Date.now() - startedAt,
      survey_year: SURVEY_YEAR,
      pulled: totalPulled,
      inserted: totalInserted,
      perVar,
    });
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      survey_year: SURVEY_YEAR,
      pulled: totalPulled,
      inserted: totalInserted,
      perVar,
    });
  } catch (err) {
    logger.error("census-acs.error", { error: String(err) });
    return NextResponse.json(
      { error: "census-acs failed", detail: String(err) },
      { status: 500 },
    );
  }
}
