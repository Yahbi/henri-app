/**
 * GET /api/cron/openfema-nfip
 *
 * Daily cron — pulls one year of FEMA NFIP redacted flood claims per
 * UTC day, rotating across years 1978-current. ~2.6M claims total
 * historical, so a full back-fill takes ~50 days of cron rotation
 * before the table catches up; ongoing daily runs keep the current
 * year fresh. Free, no auth, public-domain.
 *
 * Why this exists: NFIP flood claims are the single best signal for
 * "homeowner just had flood damage and is about to hire a restoration
 * contractor." The raw claim data is ZIP-aggregated (no PII —
 * `reportedZipCode` is the most-precise geo, county/state above).
 *
 * Strategy:
 *   - Year override via `?year=2024`
 *   - Otherwise pick today's year via UTC day-of-year mod (current_year
 *     - 1978 + 1) so a daily cron runs through every year over ~50 days
 *
 * Source:
 *   https://www.fema.gov/api/open/v2/FimaNfipClaims?$top=1000&$skip=0
 *     &$filter=yearOfLoss eq 2024
 *
 * Pagination: $top + $skip up to 1000/page. Stop on short page.
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

const ENDPOINT = "https://www.fema.gov/api/open/v2/FimaNfipClaims";
const PAGE_SIZE = 1000;
const FIRST_YEAR = 1978;

interface NfipRecord {
  id?: string;
  dateOfLoss?: string;
  yearOfLoss?: number | string;
  reportedZipCode?: string;
  county?: string;
  state?: string;
  occupancyType?: string | number;
  floors?: string | number;
  floodZone?: string;
  yearOfConstruction?: number | string;
  totalBuildingInsuranceCoverage?: number | string;
  amountPaidOnBuildingClaim?: number | string;
  amountPaidOnContentsClaim?: number | string;
  causeOfDamage?: string;
  [k: string]: unknown;
}

interface NfipPage {
  FimaNfipClaims?: NfipRecord[];
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildRow(r: NfipRecord) {
  const id = asString(r.id);
  if (!id) return null;
  return {
    fema_id: id,
    date_of_loss: asDate(r.dateOfLoss),
    year_of_loss: asInt(r.yearOfLoss),
    reported_zip_code: asString(r.reportedZipCode),
    county: asString(r.county),
    state: asString(r.state),
    occupancy_type: asString(r.occupancyType),
    floors: asString(r.floors),
    flood_zone: asString(r.floodZone),
    year_of_construction: asInt(r.yearOfConstruction),
    total_building_insurance_coverage: asNumber(
      r.totalBuildingInsuranceCoverage,
    ),
    amount_paid_on_building_claim: asNumber(r.amountPaidOnBuildingClaim),
    amount_paid_on_contents_claim: asNumber(r.amountPaidOnContentsClaim),
    cause_of_damage: asString(r.causeOfDamage),
    raw_json: r,
  };
}

/** Pick today's NFIP year by UTC day-of-year mod span. */
function todaysYear(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
  const span = now.getUTCFullYear() - FIRST_YEAR + 1;
  return FIRST_YEAR + (dayOfYear % span);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();
  const params = new URL(request.url).searchParams;

  const reqYear = Number(params.get("year"));
  const year =
    Number.isFinite(reqYear) && reqYear >= FIRST_YEAR
      ? reqYear
      : todaysYear();

  // OData filter on yearOfLoss — much smaller per-year payload than
  // pulling the full historical and post-filtering.
  const filter = encodeURIComponent(`yearOfLoss eq ${year}`);

  let skip = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 200; // 200 × 1000 = 200k rows ceiling per state-year

  try {
    while (pages < MAX_PAGES) {
      const url = `${ENDPOINT}?$top=${PAGE_SIZE}&$skip=${skip}&$filter=${filter}&$format=json`;
      let records: NfipRecord[] = [];
      let backoffSec = 2;

      // Retry the empty-but-no-end-of-data pattern that FEMA throttles with.
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          logger.warn("nfip.fetch_failed", {
            year,
            status: res.status,
            skip,
            attempt,
          });
          await new Promise((r) => setTimeout(r, backoffSec * 1000));
          backoffSec *= 2;
          continue;
        }
        const body = (await res.json()) as NfipPage;
        records = body.FimaNfipClaims ?? [];
        if (records.length > 0 || skip === 0) break;
        await new Promise((r) => setTimeout(r, backoffSec * 1000));
        backoffSec *= 2;
      }
      if (records.length === 0) break;

      const rows = records
        .map(buildRow)
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("claims_nfip")
          .upsert(rows, {
            onConflict: "fema_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          logger.warn("nfip.insert_error", {
            year,
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
      if (records.length === PAGE_SIZE) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (records.length < PAGE_SIZE) break;
    }

    logger.info("nfip.done", {
      duration_ms: Date.now() - startedAt,
      year,
      pages,
      pulled,
      inserted,
    });
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      year,
      pages,
      pulled,
      inserted,
    });
  } catch (err) {
    logger.error("nfip.error", { year, error: String(err) });
    return NextResponse.json(
      { error: "openfema-nfip failed", detail: String(err), year },
      { status: 500 },
    );
  }
}
