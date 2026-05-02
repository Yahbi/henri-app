/**
 * GET /api/cron/openfema-ia
 *
 * Daily cron — pulls FEMA Individual Assistance valid registrations
 * (IHP) by disaster_number, rotated across recent disasters per UTC
 * day. Free, no auth, public-domain.
 *
 * Why: IA registrations capture homeowners who already received
 * federal disaster recovery funds. That's the strongest restoration-
 * trade signal short of an individual claim — the homeowner has cash
 * in hand for repairs.
 *
 * Strategy: pick today's disaster_number from the last-50 declared
 * disasters in our `claims_disasters_fema` table (by declaration_date
 * DESC, indexed by `dayOfYear mod 50`). On runs where we don't yet
 * have disasters loaded, fall back to the OpenFEMA API to discover
 * recent disaster numbers ourselves.
 *
 * Override with `?disaster=4732` for back-fills of a specific event.
 *
 * Source:
 *   https://www.fema.gov/api/open/v2/IndividualsAndHouseholdsProgramValidRegistrations
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 2 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const ENDPOINT =
  "https://www.fema.gov/api/open/v2/IndividualsAndHouseholdsProgramValidRegistrations";
const DISASTERS_ENDPOINT =
  "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
const PAGE_SIZE = 1000;
const ROTATION_DEPTH = 50;

interface IaRecord {
  id?: string;
  disasterNumber?: number | string;
  damagedZipCode?: string;
  county?: string;
  state?: string;
  ownRent?: string;
  residenceType?: string;
  floodDamageAmount?: number | string;
  foundationDamageAmount?: number | string;
  roofDamageAmount?: number | string;
  [k: string]: unknown;
}

interface IaPage {
  IndividualsAndHouseholdsProgramValidRegistrations?: IaRecord[];
}

interface DisasterRecord {
  disasterNumber?: number | string;
  declarationDate?: string;
  declarationType?: string;
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

function buildRow(r: IaRecord) {
  const id = asString(r.id);
  if (!id) return null;
  return {
    fema_id: id,
    disaster_number: asInt(r.disasterNumber),
    damaged_zip_code: asString(r.damagedZipCode),
    county: asString(r.county),
    state: asString(r.state),
    own_rent: asString(r.ownRent),
    residence_type: asString(r.residenceType),
    flood_damage_amount: asNumber(r.floodDamageAmount),
    foundation_damage_amount: asNumber(r.foundationDamageAmount),
    roof_damage_amount: asNumber(r.roofDamageAmount),
    raw_json: r,
  };
}

/** UTC day-of-year, used to rotate across recent disasters fairly. */
function dayOfYear(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  return Math.floor((now.getTime() - start) / 86_400_000);
}

async function pickTodaysDisaster(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number | null> {
  // Prefer rotating across our locally-loaded disasters table — it's
  // the same data FEMA serves but cached so we don't ping FEMA twice
  // on every cron run.
  const { data: local, error } = await supabase
    .from("claims_disasters_fema")
    .select("disaster_number, declaration_date")
    .not("disaster_number", "is", null)
    .order("declaration_date", { ascending: false, nullsFirst: false })
    .limit(ROTATION_DEPTH);

  if (!error && local && local.length > 0) {
    const idx = dayOfYear() % local.length;
    const num = local[idx]?.disaster_number as number | null | undefined;
    if (typeof num === "number" && Number.isFinite(num)) return num;
  }

  // Fallback: hit OpenFEMA's disaster list directly.
  try {
    const url = `${DISASTERS_ENDPOINT}?$top=${ROTATION_DEPTH}&$orderby=declarationDate desc&$format=json`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      DisasterDeclarationsSummaries?: DisasterRecord[];
    };
    const arr = body.DisasterDeclarationsSummaries ?? [];
    if (arr.length === 0) return null;
    const idx = dayOfYear() % arr.length;
    return asInt(arr[idx]?.disasterNumber);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();
  const params = new URL(request.url).searchParams;

  const reqDisaster = Number(params.get("disaster"));
  const disaster =
    Number.isFinite(reqDisaster) && reqDisaster > 0
      ? reqDisaster
      : await pickTodaysDisaster(supabase);

  if (!disaster) {
    return NextResponse.json(
      { ok: false, error: "no disaster_number to rotate to" },
      { status: 200 },
    );
  }

  const filter = encodeURIComponent(`disasterNumber eq ${disaster}`);

  let skip = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  const MAX_PAGES = 200;

  try {
    while (pages < MAX_PAGES) {
      const url = `${ENDPOINT}?$top=${PAGE_SIZE}&$skip=${skip}&$filter=${filter}&$format=json`;
      let records: IaRecord[] = [];
      let backoffSec = 2;

      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          logger.warn("ia.fetch_failed", {
            disaster,
            status: res.status,
            skip,
            attempt,
          });
          await new Promise((r) => setTimeout(r, backoffSec * 1000));
          backoffSec *= 2;
          continue;
        }
        const body = (await res.json()) as IaPage;
        records =
          body.IndividualsAndHouseholdsProgramValidRegistrations ?? [];
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
          .from("claims_ia")
          .upsert(rows, {
            onConflict: "fema_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          logger.warn("ia.insert_error", {
            disaster,
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

    logger.info("ia.done", {
      duration_ms: Date.now() - startedAt,
      disaster,
      pages,
      pulled,
      inserted,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      disaster,
      pages,
      pulled,
      inserted,
    };
    await logCronRun("openfema-ia", startedAt, {
      pulled, inserted, summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("ia.error", { disaster, error: String(err) });
    await logCronRun("openfema-ia", startedAt, {
      pulled, inserted, summary: { disaster, pages },
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "openfema-ia failed", detail: String(err), disaster },
      { status: 500 },
    );
  }
}
