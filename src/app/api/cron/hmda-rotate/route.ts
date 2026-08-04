/**
 * GET /api/cron/hmda-rotate
 *
 * Daily cron — rotates one US state per day through CFPB's HMDA
 * Modified LAR data browser, filtered to:
 *   - actions_taken=1   (originated only)
 *   - loan_purposes=5   (home improvement — Henri's GOLD signal)
 *   - latest full year  (HMDA lags ~1 year for full-year data)
 *
 * Why rotation: 52 jurisdictions (50 states + DC + PR) and CFPB
 * rejects national queries. Each state-year of home-improvement
 * originations is 5k–150k rows — fits inside a single Vercel function
 * call. Across 52 daily runs, the full set refreshes every ~52 days.
 *
 * The state for today is picked deterministically from the UTC
 * day-of-year so re-running the cron later in the same day is a
 * no-op (idempotent via the unique loan composite). Override with
 * `?state=CA` for back-fills or manual triggers.
 *
 * Source:
 *   https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?states=CA&years=2024
 *   &actions_taken=1&loan_purposes=5
 *
 * Format: text/csv with header row. We stream-parse via the response
 * ReadableStream so very large state CSVs (CA, TX) don't OOM.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 1 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

// 50 states + DC + PR. Same set as the upstream Python loader.
const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY", "PR",
] as const;

const BATCH_SIZE = 500;

/**
 * Pick today's state via UTC day-of-year mod 52. Deterministic so
 * re-runs on the same day land on the same state.
 */
function todaysState(): string {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
  return ALL_STATES[dayOfYear % ALL_STATES.length];
}

/** RFC-4180-ish single CSV row parser (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
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
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function asNumber(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asInt(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function asString(v: string | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

interface HmdaRow {
  activity_year: number;
  state_code: string | null;
  county_code: string | null;
  census_tract: string | null;
  derived_msa_md: string | null;
  lei: string | null;
  action_taken: number | null;
  loan_purpose: number | null;
  loan_type: number | null;
  loan_amount: number | null;
  property_value: number | null;
  occupancy_type: number | null;
  total_units: string | null;
  derived_loan_product_type: string | null;
  derived_dwelling_category: string | null;
  derived_ethnicity: string | null;
  derived_race: string | null;
  derived_sex: string | null;
  interest_rate: number | null;
  income: number | null;
  raw_json: Record<string, string>;
}

function buildRow(headers: string[], cells: string[], year: number): HmdaRow | null {
  const get = (col: string) => {
    const i = headers.indexOf(col);
    return i >= 0 ? cells[i] : undefined;
  };
  // Map the row to a dict of every present header → cell, store as raw_json
  const raw: Record<string, string> = {};
  for (let i = 0; i < headers.length && i < cells.length; i++) {
    raw[headers[i]] = cells[i];
  }
  const stateCode = asString(get("state_code"));
  const activityYear = asInt(get("activity_year")) ?? year;
  if (!Number.isFinite(activityYear)) return null;
  return {
    activity_year: activityYear,
    state_code: stateCode,
    county_code: asString(get("county_code")),
    census_tract: asString(get("census_tract")),
    derived_msa_md: asString(get("derived_msa_md")),
    lei: asString(get("lei")),
    action_taken: asInt(get("action_taken")),
    loan_purpose: asInt(get("loan_purpose")),
    loan_type: asInt(get("loan_type")),
    loan_amount: asNumber(get("loan_amount")),
    property_value: asNumber(get("property_value")),
    occupancy_type: asInt(get("occupancy_type")),
    total_units: asString(get("total_units")),
    derived_loan_product_type: asString(get("derived_loan_product_type")),
    derived_dwelling_category: asString(get("derived_dwelling_category")),
    derived_ethnicity: asString(get("derived_ethnicity")),
    derived_race: asString(get("derived_race")),
    derived_sex: asString(get("derived_sex")),
    interest_rate: asNumber(get("interest_rate")),
    income: asNumber(get("income")),
    raw_json: raw,
  };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const params = new URL(request.url).searchParams;

  // Allow override for back-fills: ?state=CA&year=2023
  const stateOverride = (params.get("state") || "").toUpperCase();
  const state = ALL_STATES.includes(stateOverride as (typeof ALL_STATES)[number])
    ? stateOverride
    : todaysState();
  const reqYear = Number(params.get("year"));
  // CFPB typically publishes year N data in spring of year N+1, so
  // mid-year N+1 we may need to fall back to year N. We try the
  // requested year first, then walk back up to 2 years if CFPB
  // returns 4xx (e.g. 400 "data not available yet"). Year override
  // via ?year= short-circuits the fallback.
  const baseYear =
    Number.isFinite(reqYear) && reqYear >= 2018
      ? reqYear
      : new Date().getUTCFullYear() - 1;
  const yearCandidates = Number.isFinite(reqYear) && reqYear >= 2018
    ? [reqYear]
    : [baseYear, baseYear - 1, baseYear - 2];

  // Probe each candidate year via a HEAD-like quick GET; first one
  // that returns 200 is the year we'll actually use.
  let year = baseYear;
  for (const cand of yearCandidates) {
    const probeUrl =
      `https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?` +
      `states=${state}&years=${cand}&actions_taken=1&loan_purposes=5`;
    try {
      const probe = await fetch(probeUrl, {
        method: "GET",
        headers: {
          Referer: "https://ffiec.cfpb.gov/data-browser/",
          Accept: "text/csv,*/*;q=0.9",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Henri-Bot/1.0; cron@meethenri.com)",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
      });
      if (probe.ok) {
        year = cand;
        // Drain the probe body so we don't leak streams.
        await probe.body?.cancel();
        break;
      }
    } catch {
      /* try next candidate */
    }
  }

  const url =
    `https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?` +
    `states=${state}&years=${year}&actions_taken=1&loan_purposes=5`;

  const supabase = createAdminClient();
  let parsed = 0;
  let inserted = 0;
  let batches = 0;
  let httpStatus = 0;

  try {
    const res = await fetch(url, {
      headers: {
        // CFPB requires browser-ish headers or it returns 403.
        Referer: "https://ffiec.cfpb.gov/data-browser/",
        Accept: "text/csv,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Henri-Bot/1.0; cron@meethenri.com)",
      },
      signal: AbortSignal.timeout(240_000),
    });
    httpStatus = res.status;
    if (!res.ok || !res.body) {
      logger.warn("hmda.fetch_failed", { state, year, status: res.status });
      return NextResponse.json(
        {
          ok: false,
          state,
          year,
          status: res.status,
          duration_ms: Date.now() - startedAt,
        },
        { status: 502 },
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let leftover = "";
    let headers: string[] | null = null;
    let pendingBatch: HmdaRow[] = [];

    const flush = async () => {
      if (pendingBatch.length === 0) return;
      const slice = pendingBatch;
      pendingBatch = [];
      batches += 1;
      const { error, count } = await supabase
        .from("mortgages_hmda")
        .upsert(slice, {
          onConflict:
            "activity_year,state_code,county_code,census_tract,lei,loan_amount,action_taken",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) {
        logger.warn("hmda.insert_error", {
          state,
          year,
          batch: batches,
          error: error.message,
        });
        return;
      }
      inserted += count ?? 0;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      leftover += decoder.decode(value, { stream: true });
      // Split on \n, keep the last partial line in `leftover`.
      const lines = leftover.split("\n");
      leftover = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (line.length === 0) continue;
        if (!headers) {
          headers = parseCsvLine(line);
          continue;
        }
        const cells = parseCsvLine(line);
        const row = buildRow(headers, cells, year);
        if (!row) continue;
        pendingBatch.push(row);
        parsed += 1;
        if (pendingBatch.length >= BATCH_SIZE) {
          await flush();
        }
      }
    }
    // Drain final partial line + remaining batch.
    if (leftover.trim().length > 0 && headers) {
      const cells = parseCsvLine(leftover.replace(/\r$/, ""));
      const row = buildRow(headers, cells, year);
      if (row) {
        pendingBatch.push(row);
        parsed += 1;
      }
    }
    await flush();

    logger.info("hmda.done", {
      duration_ms: Date.now() - startedAt,
      state,
      year,
      parsed,
      inserted,
      batches,
    });

    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      state,
      year,
      parsed,
      inserted,
      batches,
      status: httpStatus,
    };
    await logCronRun("hmda-rotate", startedAt, {
      pulled: parsed,
      inserted,
      summary: result,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("hmda.error", { state, year, error: String(err) });
    await logCronRun("hmda-rotate", startedAt, {
      pulled: parsed,
      inserted,
      summary: { state, year, batches },
      error: String(err),
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      {
        error: "hmda-rotate failed",
        detail: String(err),
        state,
        year,
        parsed,
        inserted,
      },
      { status: 500 },
    );
  }
}
